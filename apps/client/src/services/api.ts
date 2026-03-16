import axios from 'axios';

/**
 * API Client
 *
 * Configured to proxy through Vite dev server (/api → localhost:3001)
 * or connect directly to the backend in production.
 */
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 1800000, // 30 min timeout for large uploads (1GB+ images)
  maxContentLength: 2 * 1024 * 1024 * 1024, // 2GB max content length
  maxBodyLength: 2 * 1024 * 1024 * 1024, // 2GB max body length
});

// ── Types ────────────────────────────────────────────────────────────────

export interface JobProgress {
  totalImages: number;
  processedImages: number;
  failedImages: number;
  pendingImages: number;
  progressPercentage: number;
}

export interface UploadResponse {
  message: string;
  enqueuedCount: number;
  files: { filename: string; jobId: string }[];
}

// ── Constants ────────────────────────────────────────────────────────────

/**
 * Maximum number of files per upload request.
 * Backend Multer limit is 10,000 — we use a smaller batch size for
 * smoother progress reporting and lower memory pressure.
 */
const UPLOAD_BATCH_SIZE = 500;

/**
 * Chunk size for large file uploads (files > 40MB)
 * Files larger than this will be split into chunks and uploaded separately
 */
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk

/**
 * Threshold for using chunked upload (files larger than this use chunks)
 */
const CHUNKED_UPLOAD_THRESHOLD = 40 * 1024 * 1024; // 40MB

// ── API Functions ────────────────────────────────────────────────────────

/**
 * Upload a single file using chunked upload for large files
 */
async function uploadFileChunked(
  file: File,
  fileId: string,
  onProgress?: (percent: number) => void,
): Promise<{ filename: string; jobId: string }[]> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const chunks: { index: number; data: Blob }[] = [];

  console.log(`[Chunked Upload] Splitting file into ${totalChunks} chunks (${CHUNK_SIZE / (1024 * 1024)} MB each)`);

  // Split file into chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkBlob = file.slice(start, end);
    chunks.push({ index: i, data: chunkBlob });
  }

  // Upload chunks sequentially
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkSizeMB = chunk.data.size / (1024 * 1024);
    console.log(`[Chunked Upload] Uploading chunk ${i + 1}/${totalChunks} (${chunkSizeMB.toFixed(2)} MB)...`);
    
    const formData = new FormData();
    formData.append('chunk', chunk.data, `chunk-${chunk.index}`);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', chunk.index.toString());
    formData.append('totalChunks', totalChunks.toString());
    formData.append('originalFilename', file.name);

    try {
      const { data } = await api.post<{
        complete: boolean;
        fileId: string;
        files?: { filename: string; jobId: string }[];
        enqueuedCount?: number;
      }>('/upload/chunk', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000, // 5 min per chunk
        maxContentLength: 2 * 1024 * 1024 * 1024, // 2GB (for response)
        maxBodyLength: 20 * 1024 * 1024, // 20MB (for request - chunk + form fields)
        onUploadProgress: (event) => {
          if (event.loaded && onProgress) {
            // Calculate overall progress for this file
            const chunkProgress = (i / totalChunks) * 100;
            const currentChunkProgress = (event.loaded / chunk.data.size) * (100 / totalChunks);
            onProgress(Math.min(99, chunkProgress + currentChunkProgress));
          }
        },
      });

      console.log(`[Chunked Upload] Chunk ${i + 1}/${totalChunks} uploaded successfully. Complete: ${data.complete}`);

      // If file is complete, return the job info
      if (data.complete && data.files) {
        console.log(`[Chunked Upload] ✅ All chunks uploaded and file reassembled`);
        return data.files;
      }
    } catch (error: any) {
      console.error(`[Chunked Upload] ❌ Failed to upload chunk ${i + 1}/${totalChunks}:`, error.message);
      throw error;
    }
  }

  throw new Error('File upload incomplete - not all chunks were processed');
}

/**
 * Upload images to the server for barcode processing.
 *
 * Large files (>40MB) are uploaded using chunked upload.
 * Smaller files are uploaded normally in batches.
 *
 * @param files    - Array of File objects to upload
 * @param onProgress - Callback with overall upload percentage (0-100)
 * @returns Combined upload response
 */
export async function uploadImages(
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  const totalFiles = files.length;
  let totalEnqueued = 0;
  const allFiles: { filename: string; jobId: string }[] = [];
  const overallTotalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let overallBytesUploaded = 0;

  // Separate files into large (chunked) and small (normal) uploads
  const largeFiles: File[] = [];
  const smallFiles: File[] = [];

  for (const file of files) {
    const fileSizeMB = file.size / (1024 * 1024);
    if (file.size > CHUNKED_UPLOAD_THRESHOLD) {
      console.log(`[Upload] File ${file.name} (${fileSizeMB.toFixed(2)} MB) will use CHUNKED upload`);
      largeFiles.push(file);
    } else {
      console.log(`[Upload] File ${file.name} (${fileSizeMB.toFixed(2)} MB) will use NORMAL upload`);
      smallFiles.push(file);
    }
  }

  console.log(`[Upload] Total files: ${files.length}, Large (chunked): ${largeFiles.length}, Small (normal): ${smallFiles.length}`);

  // Upload large files using chunked upload
  for (const file of largeFiles) {
    const fileId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const fileStartBytes = overallBytesUploaded;
    const fileSizeMB = file.size / (1024 * 1024);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    console.log(`[Upload] Starting CHUNKED upload for ${file.name} (${fileSizeMB.toFixed(2)} MB, ${totalChunks} chunks)`);
    
    try {
      const fileProgress = (percent: number) => {
        if (onProgress) {
          const fileProgressBytes = (percent / 100) * file.size;
          const currentTotal = fileStartBytes + fileProgressBytes;
          onProgress(Math.min(99, Math.round((currentTotal / overallTotalBytes) * 100)));
        }
      };

      const result = await uploadFileChunked(file, fileId, fileProgress);
      console.log(`[Upload] ✅ CHUNKED upload complete for ${file.name}`);
      allFiles.push(...result);
      totalEnqueued += result.length;
      overallBytesUploaded += file.size;
    } catch (error: any) {
      console.error(`[Upload] ❌ Failed to upload large file ${file.name}:`, error);
      throw error;
    }
  }

  // Upload small files in batches (normal upload)
  for (let i = 0; i < smallFiles.length; i += UPLOAD_BATCH_SIZE) {
    const batch = smallFiles.slice(i, i + UPLOAD_BATCH_SIZE);
    const formData = new FormData();

    for (const file of batch) {
      formData.append('images', file);
    }

    const batchBytesTotal = batch.reduce((sum, f) => sum + f.size, 0);
    let batchBytesLoaded = 0;

    const { data } = await api.post<UploadResponse>('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 1800000, // 30 min per batch
      maxContentLength: 2 * 1024 * 1024 * 1024, // 2GB
      maxBodyLength: 2 * 1024 * 1024 * 1024, // 2GB
      onUploadProgress: (event) => {
        if (event.loaded && onProgress) {
          batchBytesLoaded = event.loaded;
          const currentTotal = overallBytesUploaded + batchBytesLoaded;
          onProgress(
            Math.min(99, Math.round((currentTotal / overallTotalBytes) * 100)),
          );
        }
      },
    });

    overallBytesUploaded += batchBytesTotal;
    totalEnqueued += data.enqueuedCount;
    allFiles.push(...data.files);
  }

  onProgress?.(100);

  return {
    message: `${totalEnqueued} image(s) uploaded and queued for processing`,
    enqueuedCount: totalEnqueued,
    files: allFiles,
  };
}

/**
 * Upload images with their manually cropped barcode regions.
 * 
 * This function uploads both the original full images and their corresponding
 * cropped barcode images. The relationship is maintained by array index.
 * 
 * @param files    - Array of original File objects
 * @param crops    - Map of imageIndex → cropped barcode Blob
 * @param onProgress - Callback with overall upload percentage (0-100)
 * @returns Combined upload response
 */
export async function uploadImagesWithCrops(
  files: File[],
  crops: Map<number, Blob>,
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  if (files.length !== crops.size) {
    throw new Error(`Mismatch: ${files.length} files but ${crops.size} crops`);
  }

  const totalFiles = files.length;
  let totalEnqueued = 0;
  const allFiles: { filename: string; jobId: string }[] = [];
  const overallTotalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let overallBytesUploaded = 0;

  console.log(`[Upload with Crops] Starting upload: ${totalFiles} files with ${crops.size} cropped barcodes`);

  // Upload in batches to avoid overwhelming the server
  for (let i = 0; i < files.length; i += UPLOAD_BATCH_SIZE) {
    const batch = files.slice(i, i + UPLOAD_BATCH_SIZE);
    const formData = new FormData();

    // Create mapping array to maintain relationship
    const mapping: Array<{ originalIndex: number; originalName: string; cropIndex: number }> = [];

    // Add original files and their corresponding crops
    batch.forEach((file, batchIndex) => {
      const globalIndex = i + batchIndex;
      const crop = crops.get(globalIndex);
      
      if (!crop) {
        throw new Error(`Missing crop for file ${globalIndex}: ${file.name}`);
      }

      // Add original file
      formData.append('originals', file);
      
      // Add crop as a File object (convert Blob to File for proper naming)
      const cropFile = new File([crop], `crop-${globalIndex}.jpg`, { type: 'image/jpeg' });
      formData.append('crops', cropFile);

      // Store mapping
      mapping.push({
        originalIndex: globalIndex,
        originalName: file.name,
        cropIndex: batchIndex,
      });
    });

    // Add mapping as JSON
    formData.append('mapping', JSON.stringify(mapping));

    const batchBytesTotal = batch.reduce((sum, f) => sum + f.size, 0);
    let batchBytesLoaded = 0;

    try {
      const { data } = await api.post<UploadResponse>('/upload/with-crops', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 1800000, // 30 min per batch
        maxContentLength: 2 * 1024 * 1024 * 1024, // 2GB
        maxBodyLength: 2 * 1024 * 1024 * 1024, // 2GB
        onUploadProgress: (event) => {
          if (event.loaded && onProgress) {
            batchBytesLoaded = event.loaded;
            const currentTotal = overallBytesUploaded + batchBytesLoaded;
            onProgress(
              Math.min(99, Math.round((currentTotal / overallTotalBytes) * 100)),
            );
          }
        },
      });

      overallBytesUploaded += batchBytesTotal;
      totalEnqueued += data.enqueuedCount;
      allFiles.push(...data.files);
      
      console.log(`[Upload with Crops] Batch ${Math.floor(i / UPLOAD_BATCH_SIZE) + 1} complete: ${data.enqueuedCount} files enqueued`);
    } catch (error: any) {
      console.error(`[Upload with Crops] Batch upload failed:`, error);
      throw error;
    }
  }

  onProgress?.(100);

  console.log(`[Upload with Crops] ✅ All batches uploaded: ${totalEnqueued} files enqueued`);

  return {
    message: `${totalEnqueued} image(s) with cropped barcodes uploaded and queued for processing`,
    enqueuedCount: totalEnqueued,
    files: allFiles,
  };
}

/**
 * Fetch current processing progress from the server.
 * Called by React Query every 2 seconds.
 */
export async function fetchProgress(): Promise<JobProgress> {
  const { data } = await api.get<JobProgress>('/jobs/progress');
  return data;
}

/**
 * Reset the processing queue and progress counters.
 */
export async function resetProgress(): Promise<void> {
  await api.post('/jobs/reset');
}

/**
 * Download processed images as a ZIP file.
 * Triggers a file download in the browser.
 */
export async function downloadZip(): Promise<void> {
  try {
    console.log('[Download] Starting ZIP download...');
    
    const response = await api.get('/download/zip', {
      responseType: 'blob',
      timeout: 600000, // 10 min timeout for large ZIPs
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          console.log(`[Download] Progress: ${percentCompleted}%`);
        }
      },
    });

    console.log('[Download] ZIP received, size:', response.data.size, 'bytes');

    // Verify we got a blob
    if (!(response.data instanceof Blob)) {
      throw new Error('Response is not a blob');
    }

    // Create a download link and trigger it
    const url = window.URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'processed-images.zip');
    link.style.display = 'none';
    document.body.appendChild(link);
    
    // Trigger download
    link.click();
    
    // Cleanup after a short delay
    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      console.log('[Download] ZIP download triggered successfully');
    }, 100);
  } catch (error: any) {
    console.error('[Download] ZIP download failed:', error);
    
    // If it's a network error, provide more details
    if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
      throw new Error('Network error: Unable to download ZIP file. Please check your connection and try again.');
    }
    
    // If it's a timeout
    if (error.code === 'ECONNABORTED') {
      throw new Error('Download timeout: The ZIP file is too large. Please try again or contact support.');
    }
    
    throw error;
  }
}

export default api;

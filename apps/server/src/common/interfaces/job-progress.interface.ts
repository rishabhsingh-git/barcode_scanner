/**
 * Represents the overall progress of the image processing pipeline.
 * Returned by GET /jobs/progress endpoint.
 */
export interface JobProgress {
  /** Total number of images uploaded in the current batch */
  totalImages: number;
  /** Number of images successfully processed (barcode detected & renamed) */
  processedImages: number;
  /** Number of images that failed barcode detection */
  failedImages: number;
  /** Number of images still waiting or actively being processed */
  pendingImages: number;
  /** Overall progress percentage (0-100) */
  progressPercentage: number;
}

/**
 * Data payload for each image processing job in the BullMQ queue.
 */
export interface ImageJobData {
  /** Original filename as uploaded by the user */
  originalFilename: string;
  /** Full path to the file in storage/original */
  filePath: string;
  /** File extension (e.g., '.jpeg', '.png') */
  extension: string;
  /** Optional path to manually cropped barcode image in storage/crops */
  cropFilePath?: string;
}

/**
 * Result returned by a successfully completed image processing job.
 */
export interface ImageJobResult {
  /** The barcode value detected in the image */
  barcodeValue: string;
  /** Path to the renamed file in storage/processed */
  outputPath: string;
  /** Processing duration in milliseconds */
  processingTimeMs: number;
}


import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { uploadImages, uploadImagesWithCrops, resetProgress, type UploadResponse } from '../services/api';

/**
 * useUpload Hook
 *
 * Handles the image upload workflow:
 * 1. Reset previous progress
 * 2. Upload files via multipart form-data (batched in chunks of 500)
 * 3. Track upload progress
 * 4. Invalidate progress query to trigger re-fetch
 * 
 * Supports both regular uploads and uploads with manually cropped barcodes.
 */
export function useUpload() {
  const [uploadProgress, setUploadProgress] = useState(0);
  const queryClient = useQueryClient();

  const mutation = useMutation<
    UploadResponse,
    Error,
    { files: File[]; crops?: Map<number, Blob> }
  >({
    mutationFn: async ({ files, crops }) => {
      setUploadProgress(0);

      // Reset previous batch progress before uploading
      await resetProgress();

      const hasCrops = crops && crops.size === files.length;

      toast.info('Upload started', {
        description: hasCrops
          ? `Uploading ${files.length.toLocaleString()} image(s) with cropped barcodes...`
          : `Uploading ${files.length.toLocaleString()} image(s)...`,
      });

      // Upload files with or without crops
      const result = hasCrops
        ? await uploadImagesWithCrops(files, crops, (percent) => {
            setUploadProgress(percent);
          })
        : await uploadImages(files, (percent) => {
            setUploadProgress(percent);
          });

      return result;
    },
    onSuccess: (data) => {
      toast.success('Upload completed!', {
        description: `${data.enqueuedCount.toLocaleString()} images queued for processing`,
      });
      // Invalidate progress query so it refetches immediately
      queryClient.invalidateQueries({ queryKey: ['jobProgress'] });
    },
    onError: (error) => {
      toast.error('Upload failed', {
        description: error.message || 'An unexpected error occurred',
      });
    },
    onSettled: () => {
      // Reset upload progress after completion or error
      setTimeout(() => setUploadProgress(0), 1000);
    },
  });

  const upload = useCallback(
    (files: File[], crops?: Map<number, Blob>) => {
      mutation.mutate({ files, crops });
    },
    [mutation],
  );

  return {
    upload,
    uploadProgress,
    isUploading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
  };
}

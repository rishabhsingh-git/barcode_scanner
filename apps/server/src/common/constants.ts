import * as path from 'path';

/** Name of the BullMQ queue for image processing jobs */
export const IMAGE_QUEUE_NAME = 'image-processing';

/** Name of the job type within the queue */
export const PROCESS_IMAGE_JOB = 'process-image';

/** Redis key prefix for tracking total uploaded images count */
export const REDIS_TOTAL_IMAGES_KEY = 'barocode:total_images';

/** Redis key for tracking successfully processed images count */
export const REDIS_PROCESSED_IMAGES_KEY = 'barocode:processed_images';

/** Redis key for tracking failed images count */
export const REDIS_FAILED_IMAGES_KEY = 'barocode:failed_images';

/** Base storage path (resolved from environment or default) */
export const STORAGE_BASE = path.resolve(
  process.env.UPLOAD_PATH || './storage',
);

/** Directory for original uploaded images */
export const STORAGE_ORIGINAL = path.join(STORAGE_BASE, 'original');

/** Directory for successfully processed (renamed) images */
export const STORAGE_PROCESSED = path.join(STORAGE_BASE, 'processed');

/** Directory for images that failed barcode detection */
export const STORAGE_FAILED = path.join(STORAGE_BASE, 'failed');

/** Directory for temporarily stored cropped barcode images */
export const STORAGE_CROPS = path.join(STORAGE_BASE, 'crops');


import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import {
  IMAGE_QUEUE_NAME,
  REDIS_TOTAL_IMAGES_KEY,
  REDIS_PROCESSED_IMAGES_KEY,
  REDIS_FAILED_IMAGES_KEY,
  STORAGE_ORIGINAL,
  STORAGE_PROCESSED,
  STORAGE_FAILED,
  STORAGE_CROPS,
} from '../../common/constants';
import { JobProgress } from '../../common/interfaces/job-progress.interface';

/**
 * Queue Service
 *
 * Provides methods to query the current state of the image processing queue.
 * Used by the Jobs controller to serve progress data to the frontend.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(IMAGE_QUEUE_NAME) private readonly imageQueue: Queue,
  ) {}

  /**
   * Get the current processing progress from BullMQ job counts.
   * Total images is tracked separately in Redis for accuracy
   * (since removeOnComplete may clean up completed jobs).
   */
  async getProgress(): Promise<JobProgress> {
    const redisClient = await this.imageQueue.client;

    // Read all counters from Redis (tracked independently of BullMQ job retention)
    const [totalStr, processedStr, failedStr] = await Promise.all([
      redisClient.get(REDIS_TOTAL_IMAGES_KEY),
      redisClient.get(REDIS_PROCESSED_IMAGES_KEY),
      redisClient.get(REDIS_FAILED_IMAGES_KEY),
    ]);

    let totalImages = totalStr ? parseInt(totalStr, 10) : 0;
    let processedImages = processedStr ? parseInt(processedStr, 10) : 0;
    let failedImages = failedStr ? parseInt(failedStr, 10) : 0;

    // Fallback: if Redis counters are missing/zero but files exist on disk,
    // derive counts from storage directories so downloads don't stay disabled.
    const countFiles = async (dirPath: string): Promise<number> => {
      try {
        const files = await fs.promises.readdir(dirPath);
        return files.filter((f) => !f.startsWith('.')).length;
      } catch {
        return 0;
      }
    };

    if (totalImages === 0 || (processedImages === 0 && failedImages === 0)) {
      const [processedOnDisk, failedOnDisk] = await Promise.all([
        countFiles(STORAGE_PROCESSED),
        countFiles(STORAGE_FAILED),
      ]);

      if (processedOnDisk > 0 || failedOnDisk > 0) {
        processedImages = Math.max(processedImages, processedOnDisk);
        failedImages = Math.max(failedImages, failedOnDisk);
        totalImages = Math.max(totalImages, processedImages + failedImages);
      }
    }
    const pendingImages = totalImages - processedImages - failedImages;

    // Calculate progress percentage (avoid division by zero)
    const progressPercentage =
      totalImages > 0
        ? Math.round(((processedImages + failedImages) / totalImages) * 100)
        : 0;

    return {
      totalImages,
      processedImages,
      failedImages,
      pendingImages: Math.max(0, pendingImages),
      progressPercentage: Math.min(100, progressPercentage),
    };
  }

  /**
   * Reset all progress counters. Called when a new batch upload starts.
   * Cleans ALL storage directories including crops and temp chunks.
   */
  async resetProgress(): Promise<void> {
    const redisClient = await this.imageQueue.client;

    // Reset all Redis counters
    await Promise.all([
      redisClient.set(REDIS_TOTAL_IMAGES_KEY, '0'),
      redisClient.set(REDIS_PROCESSED_IMAGES_KEY, '0'),
      redisClient.set(REDIS_FAILED_IMAGES_KEY, '0'),
    ]);

    // Obliterate the queue (remove all jobs)
    await this.imageQueue.obliterate({ force: true });

    // Clean ALL storage directories (including crops and temp chunks)
    await Promise.all([
      this.cleanDirectory(STORAGE_ORIGINAL),
      this.cleanDirectory(STORAGE_PROCESSED),
      this.cleanDirectory(STORAGE_FAILED),
      this.cleanDirectory(STORAGE_CROPS),
    ]);

    this.logger.log('Queue, progress counters, and all storage directories reset');
  }

  /**
   * Remove all files AND subdirectories from a directory without deleting the directory itself.
   */
  private async cleanDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await fs.promises.rm(fullPath, { recursive: true, force: true }).catch(() => {});
          } else {
            await fs.promises.unlink(fullPath).catch(() => {});
          }
        }),
      );
    } catch {
      // Directory may not exist yet — that's fine
    }
  }
}


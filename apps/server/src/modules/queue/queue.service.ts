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

    const totalImages = totalStr ? parseInt(totalStr, 10) : 0;
    const processedImages = processedStr ? parseInt(processedStr, 10) : 0;
    const failedImages = failedStr ? parseInt(failedStr, 10) : 0;
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

    // Clean storage directories (remove old files from previous batches)
    await this.cleanDirectory(STORAGE_ORIGINAL);
    await this.cleanDirectory(STORAGE_PROCESSED);
    await this.cleanDirectory(STORAGE_FAILED);

    this.logger.log('Queue, progress counters, and storage reset');
  }

  /**
   * Remove all files from a directory without deleting the directory itself.
   */
  private async cleanDirectory(dirPath: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(dirPath);
      await Promise.all(
        files.map((file) =>
          fs.promises.unlink(path.join(dirPath, file)).catch(() => {}),
        ),
      );
    } catch {
      // Directory may not exist yet — that's fine
    }
  }
}


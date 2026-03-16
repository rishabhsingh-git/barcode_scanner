import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import {
  IMAGE_QUEUE_NAME,
  PROCESS_IMAGE_JOB,
  REDIS_TOTAL_IMAGES_KEY,
} from '../../common/constants';
import { ImageJobData } from '../../common/interfaces/job-progress.interface';

/**
 * Upload Service
 *
 * Handles enqueueing uploaded images into the BullMQ processing queue.
 * Each file gets a separate job so workers can process them in parallel.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    @InjectQueue(IMAGE_QUEUE_NAME) private readonly imageQueue: Queue,
  ) {}

  /**
   * Enqueue all uploaded files as individual processing jobs.
   * Also increments the total image counter in Redis for progress tracking.
   */
  async enqueueFiles(files: Express.Multer.File[]) {
    const enqueuedFiles: { filename: string; jobId: string }[] = [];

    // Increment total images counter in Redis (atomic operation)
    const redisClient = await this.imageQueue.client;
    await redisClient.incrby(REDIS_TOTAL_IMAGES_KEY, files.length);

    // Enqueue each file as a separate job for parallel processing
    for (const file of files) {
      const jobData: ImageJobData = {
        originalFilename: file.originalname,
        filePath: file.path,
        extension: path.extname(file.originalname).toLowerCase(),
      };

      // Note: Lock duration is configured at worker level (10 minutes)
      // This allows processing of 1GB+ images without lock expiration
      const job = await this.imageQueue.add(PROCESS_IMAGE_JOB, jobData, {
        // Each job gets a unique ID based on the stored filename
        jobId: file.filename,
      });

      enqueuedFiles.push({
        filename: file.originalname,
        jobId: job.id!,
      });

      this.logger.verbose(
        `Enqueued job ${job.id} for file: ${file.originalname}`,
      );
    }

    this.logger.log(`Enqueued ${files.length} image processing job(s)`);

    return {
      enqueuedCount: enqueuedFiles.length,
      files: enqueuedFiles,
    };
  }

  /**
   * Enqueue files with their corresponding cropped barcode images.
   * Maintains strong relationship between original and crop by pairing them.
   * 
   * @param pairedFiles - Array of { original, crop } pairs
   */
  async enqueueFilesWithCrops(
    pairedFiles: Array<{
      original: Express.Multer.File;
      crop: Express.Multer.File;
    }>,
  ) {
    const enqueuedFiles: { filename: string; jobId: string }[] = [];

    // Increment total images counter in Redis (atomic operation)
    const redisClient = await this.imageQueue.client;
    await redisClient.incrby(REDIS_TOTAL_IMAGES_KEY, pairedFiles.length);

    // Enqueue each original-crop pair as a separate job
    for (const { original, crop } of pairedFiles) {
      // Verify crop file exists before enqueueing
      if (!fs.existsSync(crop.path)) {
        this.logger.error(`Crop file does not exist: ${crop.path}`);
        throw new Error(`Crop file not found: ${crop.path}`);
      }
      
      const cropStats = fs.statSync(crop.path);
      const cropSizeMB = (cropStats.size / (1024 * 1024)).toFixed(2);
      this.logger.log(`Enqueueing job with crop: ${crop.path} (${cropSizeMB} MB)`);
      
      const jobData: ImageJobData = {
        originalFilename: original.originalname,
        filePath: original.path,
        extension: path.extname(original.originalname).toLowerCase(),
        cropFilePath: crop.path, // Strong relationship: crop path linked to original
      };

      // Note: Lock duration is configured at worker level (10 minutes)
      const job = await this.imageQueue.add(PROCESS_IMAGE_JOB, jobData, {
        // Each job gets a unique ID based on the stored filename
        jobId: original.filename,
      });

      enqueuedFiles.push({
        filename: original.originalname,
        jobId: job.id!,
      });

      this.logger.verbose(
        `Enqueued job ${job.id} for file: ${original.originalname} with crop: ${crop.filename} (${cropSizeMB} MB)`,
      );
    }

    this.logger.log(
      `Enqueued ${pairedFiles.length} image processing job(s) with cropped barcodes`,
    );

    return {
      enqueuedCount: enqueuedFiles.length,
      files: enqueuedFiles,
    };
  }
}


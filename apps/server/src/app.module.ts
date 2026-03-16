import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IMAGE_QUEUE_NAME } from './common/constants';
import { UploadModule } from './modules/upload/upload.module';
import { QueueModule } from './modules/queue/queue.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ZipModule } from './modules/zip/zip.module';
import { BarcodeModule } from './modules/barcode/barcode.module';

@Module({
  imports: [
    // ── Global BullMQ configuration ──────────────────────────────────────
    // Connects to Redis and registers the image processing queue.
    // The worker runs as a separate process (npm run worker).
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: null, // Required for BullMQ workers
      },
    }),

    // Register the image processing queue
    BullModule.registerQueue({
      name: IMAGE_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600, count: 10000 }, // Keep for 1 hour, max 10k
        removeOnFail: { age: 86400, count: 50000 },    // Keep failed for 24 hours
        // CRITICAL: Increase lock duration for large images (1GB+ can take 5-10 minutes)
        // Note: This is set per-job, worker also has lockDuration setting
      },
    }),

    // ── Feature modules ──────────────────────────────────────────────────
    UploadModule,
    BarcodeModule,
    QueueModule,
    JobsModule,
    ZipModule,
  ],
})
export class AppModule {}


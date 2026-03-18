/**
 * Image Processing Worker (Standalone Process)
 *
 * This worker runs as a SEPARATE process from the NestJS API server.
 * It connects to Redis, picks up jobs from the image-processing queue,
 * and processes them using Dynamsoft Barcode Reader SDK via image.processor.
 *
 * Run with: npm run worker (or: npx tsx src/workers/image.worker.ts)
 *
 * Features:
 *   - Uses Dynamsoft SDK for barcode detection
 *   - Automatically crops images to top 30% before scanning
 *   - Worker concurrency is configurable (default 10)
 *
 * Environment variables:
 *   MAX_WORKER_CONCURRENCY  – BullMQ worker concurrency  (default 10)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { bullConfig, workerConfig } from '../modules/queue/bull.config';
import { processImage, warmupGoogleVisionClient } from '../modules/queue/image.processor';
// OpenAI code kept aside - not used but available
// import { openaiConfig } from '../common/openai-client';
import {
  IMAGE_QUEUE_NAME,
  PROCESS_IMAGE_JOB,
  STORAGE_ORIGINAL,
  STORAGE_PROCESSED,
  STORAGE_FAILED,
  STORAGE_CROPS,
  REDIS_PROCESSED_IMAGES_KEY,
  REDIS_FAILED_IMAGES_KEY,
} from '../common/constants';
import { ImageJobData } from '../common/interfaces/job-progress.interface';

// ── Redis client for progress counter updates ────────────────────────────
const redis = new Redis({
  host: bullConfig.connection.host,
  port: bullConfig.connection.port,
  maxRetriesPerRequest: null,
});

// ── Ensure storage directories exist ─────────────────────────────────────
for (const dir of [STORAGE_ORIGINAL, STORAGE_PROCESSED, STORAGE_FAILED, STORAGE_CROPS]) {
  fs.mkdirSync(dir, { recursive: true });
}

// BullMQ concurrency for Dynamsoft processing
const effectiveConcurrency = workerConfig.concurrency;

console.log('═══════════════════════════════════════════════════════════');
console.log('  🔧 Barocode Image Processing Worker (Dynamsoft Python SDK)');
console.log(`  📂 Storage:  ${path.resolve(STORAGE_ORIGINAL, '..')}`);
console.log(`  🔗 Redis:    ${bullConfig.connection.host}:${bullConfig.connection.port}`);
console.log(`  📦 Scanner:  Dynamsoft Python SDK (detect_barcode.py)`);
console.log(`  ✂️  Crop:     Top 30% of image`);
console.log(`  ⚡ BullMQ concurrency:  ${effectiveConcurrency}`);
console.log('═══════════════════════════════════════════════════════════');

// ── Create BullMQ Worker ─────────────────────────────────────────────────
const worker = new Worker<ImageJobData>(
  IMAGE_QUEUE_NAME,
  async (job: Job<ImageJobData>) => {
    const { originalFilename, filePath } = job.data;
    const fileSizeMB = fs.existsSync(filePath) 
      ? (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2)
      : 'unknown';

    console.log(
      `[Job ${job.id}] ▶ Processing: ${originalFilename} (${fileSizeMB} MB)`,
    );

    // Update job progress
    await job.updateProgress(10);

    // Set up lock renewal interval for long-running jobs
    // Large images (1GB+) can take several minutes to process
    let currentProgress = 10;
    const lockRenewInterval = setInterval(async () => {
      try {
        // Update progress to renew lock (keep current progress value)
        await job.updateProgress(currentProgress);
      } catch (err) {
        // Ignore errors during lock renewal
      }
    }, 25000); // Renew every 25 seconds (before 30s default renewal)

    try {
      const result = await processImage(job.data);

      // Clear lock renewal interval
      clearInterval(lockRenewInterval);
      
      currentProgress = 100;
      await job.updateProgress(100);

      console.log(
        `[Job ${job.id}] ✅ Success: ${originalFilename} → ${result.barcodeValue} (${result.processingTimeMs}ms)`,
      );

      return result;
    } catch (error: any) {
      // Clear lock renewal interval on error
      clearInterval(lockRenewInterval);
      
      console.error(
        `[Job ${job.id}] ❌ Failed: ${originalFilename} — ${error.message}`,
      );
      throw error; // Re-throw so BullMQ marks the job as failed
    }
  },
  {
    connection: bullConfig.connection,
    concurrency: effectiveConcurrency,
    limiter: {
      max: effectiveConcurrency,
      duration: 1000, // Rate limit: max N jobs per second
    },
    // Worker settings for large image processing
    lockDuration: 600000, // 10 minutes lock duration
    lockRenewTime: 30000, // Renew lock every 30 seconds
    maxStalledCount: 2, // Allow 2 stalled attempts before failing
    stalledInterval: 30000, // Check for stalled jobs every 30 seconds
  },
);

// ── Worker Event Handlers ────────────────────────────────────────────────
worker.on('ready', () => {
  console.log('✅ Worker is ready and listening for jobs...');
});

worker.on('completed', (job) => {
  if (job) {
    // Atomically increment processed counter in Redis
    redis.incr(REDIS_PROCESSED_IMAGES_KEY).catch(() => {});
    console.log(
      `[Job ${job.id}] 🏁 Completed successfully`,
    );
  }
});

worker.on('failed', (job, error) => {
  if (job) {
    // Atomically increment failed counter in Redis
    redis.incr(REDIS_FAILED_IMAGES_KEY).catch(() => {});
    console.error(
      `[Job ${job.id}] 💀 Failed permanently after ${job.attemptsMade} attempts: ${error.message}`,
    );
  }
});

worker.on('error', (error) => {
  console.error(`Worker error: ${error.message}`);
});

worker.on('stalled', (jobId) => {
  console.warn(`[Job ${jobId}] ⚠ Job stalled — will be retried`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────
async function shutdown() {
  console.log('\n🛑 Shutting down worker gracefully...');
  await worker.close();
  await redis.quit();
  console.log('Worker closed. Goodbye!');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('🚀 Worker started. Waiting for jobs...\n');

// Warm up Google Vision at startup to reduce latency for the first processed image
warmupGoogleVisionClient().then(() => {
  console.log('✅ Google Vision warmup complete');
}).catch(() => {
  // ignore
});

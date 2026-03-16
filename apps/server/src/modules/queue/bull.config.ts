/**
 * BullMQ Configuration
 *
 * Centralized configuration for BullMQ queue and worker settings.
 * Both the API server and standalone worker import from here.
 */
export const bullConfig = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null as null, // Required for BullMQ worker compatibility
  },
};

export const workerConfig = {
  /** Number of concurrent image processing jobs */
  concurrency: parseInt(process.env.MAX_WORKER_CONCURRENCY || '20', 10),

  /** Retry settings for failed jobs */
  attempts: 3,

  /** Exponential backoff: 5s, 10s, 20s */
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
};


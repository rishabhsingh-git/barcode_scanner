import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { JobProgress } from '../../common/interfaces/job-progress.interface';

/**
 * Jobs Service
 *
 * Thin wrapper over QueueService for the Jobs controller.
 * Keeps the controller lean and allows adding business logic if needed.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly queueService: QueueService) {}

  async getProgress(): Promise<JobProgress> {
    const progress = await this.queueService.getProgress();

    this.logger.verbose(
      `Progress: ${progress.processedImages}/${progress.totalImages} ` +
        `(${progress.progressPercentage}%) | Failed: ${progress.failedImages}`,
    );

    return progress;
  }

  async resetProgress(): Promise<void> {
    return this.queueService.resetProgress();
  }
}


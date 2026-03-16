import { Controller, Get, Post, Logger } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobProgress } from '../../common/interfaces/job-progress.interface';

/**
 * Jobs Controller
 *
 * GET  /jobs/progress — Returns current processing progress stats.
 * POST /jobs/reset    — Resets all progress counters and clears the queue.
 */
@Controller('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(private readonly jobsService: JobsService) {}

  /**
   * Returns the current processing progress.
   * Polled by the frontend every 2 seconds via React Query.
   */
  @Get('progress')
  async getProgress(): Promise<JobProgress> {
    return this.jobsService.getProgress();
  }

  /**
   * Resets the queue and progress counters.
   * Used before starting a new batch upload.
   */
  @Post('reset')
  async resetProgress(): Promise<{ message: string }> {
    await this.jobsService.resetProgress();
    this.logger.log('Progress and queue reset by user');
    return { message: 'Queue and progress counters reset successfully' };
  }
}


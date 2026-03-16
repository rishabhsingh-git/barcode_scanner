import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IMAGE_QUEUE_NAME } from '../../common/constants';
import { QueueService } from './queue.service';

/**
 * Queue Module
 *
 * Provides access to the BullMQ image processing queue.
 * Used by the Jobs module to query queue status and progress.
 */
@Module({
  imports: [BullModule.registerQueue({ name: IMAGE_QUEUE_NAME })],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}


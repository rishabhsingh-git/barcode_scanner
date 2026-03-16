import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [QueueModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}


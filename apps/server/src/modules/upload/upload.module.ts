import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IMAGE_QUEUE_NAME } from '../../common/constants';
import { UploadController } from './upload.controller';
import { UploadChunkController } from './upload-chunk.controller';
import { UploadService } from './upload.service';
import { UploadChunkService } from './upload-chunk.service';

@Module({
  imports: [
    // Inject the image-processing queue so UploadService can enqueue jobs
    BullModule.registerQueue({ name: IMAGE_QUEUE_NAME }),
  ],
  controllers: [UploadController, UploadChunkController],
  providers: [UploadService, UploadChunkService],
})
export class UploadModule {}


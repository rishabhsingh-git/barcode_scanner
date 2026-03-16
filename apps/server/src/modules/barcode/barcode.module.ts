import { Module } from '@nestjs/common';
import { BarcodeService } from './barcode.service';
import { GoogleVisionClient } from '../../common/google-vision-client';

@Module({
  providers: [BarcodeService, GoogleVisionClient],
  exports: [BarcodeService, GoogleVisionClient],
})
export class BarcodeModule {}


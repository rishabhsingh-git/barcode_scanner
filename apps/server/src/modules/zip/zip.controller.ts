import {
  Controller,
  Get,
  Res,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ZipService } from './zip.service';
import { STORAGE_PROCESSED, STORAGE_ORIGINAL, STORAGE_FAILED } from '../../common/constants';

@Controller('download')
export class ZipController {
  private readonly logger = new Logger(ZipController.name);

  constructor(private readonly zipService: ZipService) {}

  /**
   * Shared helper: build archive, pipe to response, THEN finalize.
   * This ordering guarantees that data is consumed as it's produced,
   * preventing buffer overflows and ensuring 100% of files reach the client.
   */
  private async streamZip(
    res: Response,
    storageDir: string,
    label: string,
    filename: string,
  ): Promise<void> {
    const { archive, fileCount } = await this.zipService.buildZipArchive(storageDir, label);

    if (fileCount === 0) {
      throw new HttpException(`No ${label} images available for download`, HttpStatus.NOT_FOUND);
    }

    this.logger.log(`[${label}] Streaming ZIP with ${fileCount} file(s)`);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Transfer-Encoding': 'chunked',
      'X-File-Count': String(fileCount),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-File-Count',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-cache',
    });

    archive.on('error', (err) => {
      this.logger.error(`[${label}] ZIP error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: `Failed to create ${label} ZIP archive` });
      }
    });

    // CRITICAL: pipe FIRST, then finalize. This ensures the writable is
    // consuming data before archiver starts producing, preventing lost data.
    archive.pipe(res);
    archive.finalize();

    archive.on('end', () => {
      this.logger.log(`[${label}] ZIP download completed (${fileCount} files)`);
    });
  }

  @Get('zip')
  async downloadZip(@Res() res: Response) {
    return this.streamZip(res, STORAGE_PROCESSED, 'processed', 'processed-images.zip');
  }

  @Get('original-zip')
  async downloadOriginalZip(@Res() res: Response) {
    return this.streamZip(res, STORAGE_ORIGINAL, 'original', 'original-images.zip');
  }

  @Get('failed-zip')
  async downloadFailedZip(@Res() res: Response) {
    return this.streamZip(res, STORAGE_FAILED, 'failed', 'failed-images.zip');
  }
}


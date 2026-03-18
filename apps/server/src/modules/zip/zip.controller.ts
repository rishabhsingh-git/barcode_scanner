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

/**
 * Zip Controller
 *
 * GET /download/zip — Streams a ZIP archive of all processed images.
 * Uses streaming to avoid loading all images into memory at once.
 */
@Controller('download')
export class ZipController {
  private readonly logger = new Logger(ZipController.name);

  constructor(private readonly zipService: ZipService) {}

  @Get('zip')
  async downloadZip(@Res() res: Response) {
    this.logger.log('ZIP download requested');

    const fileCount = await this.zipService.getProcessedFileCount();

    if (fileCount === 0) {
      throw new HttpException(
        'No processed images available for download',
        HttpStatus.NOT_FOUND,
      );
    }

    this.logger.log(`Streaming ZIP archive with ${fileCount} file(s)`);

    // Set response headers for file download
    // Include CORS headers for blob downloads
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="processed-images.zip"',
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-cache',
    });

    // Stream the ZIP archive directly to the response
    const archive = this.zipService.createZipStream();

    // Handle archive errors
    archive.on('error', (err) => {
      this.logger.error(`ZIP archive error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create ZIP archive' });
      }
    });

    // Pipe archive to response
    archive.pipe(res);

    // Log completion
    archive.on('end', () => {
      this.logger.log(`ZIP download completed (${fileCount} files)`);
    });
  }

  /**
   * GET /download/original-zip — Streams a ZIP archive of all ORIGINAL uploaded images.
   */
  @Get('original-zip')
  async downloadOriginalZip(@Res() res: Response) {
    this.logger.log('Original ZIP download requested');

    const fileCount = await this.zipService.getOriginalFileCount();

    if (fileCount === 0) {
      throw new HttpException('No original images available for download', HttpStatus.NOT_FOUND);
    }

    this.logger.log(`Streaming ORIGINAL ZIP archive with ${fileCount} file(s)`);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="original-images.zip"',
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-cache',
    });

    const archive = this.zipService.createOriginalZipStream();

    archive.on('error', (err) => {
      this.logger.error(`Original ZIP archive error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create original ZIP archive' });
      }
    });

    archive.pipe(res);

    archive.on('end', () => {
      this.logger.log(`Original ZIP download completed (${fileCount} files)`);
    });
  }

  /**
   * GET /download/failed-zip — Streams a ZIP archive of all FAILED images.
   */
  @Get('failed-zip')
  async downloadFailedZip(@Res() res: Response) {
    this.logger.log('Failed ZIP download requested');

    const fileCount = await this.zipService.getFailedFileCount();
    if (fileCount === 0) {
      throw new HttpException('No failed images available for download', HttpStatus.NOT_FOUND);
    }

    this.logger.log(`Streaming FAILED ZIP archive with ${fileCount} file(s)`);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="failed-images.zip"',
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-cache',
    });

    const archive = this.zipService.createFailedZipStream();

    archive.on('error', (err) => {
      this.logger.error(`Failed ZIP archive error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create failed ZIP archive' });
      }
    });

    archive.pipe(res);

    archive.on('end', () => {
      this.logger.log(`Failed ZIP download completed (${fileCount} files)`);
    });
  }
}


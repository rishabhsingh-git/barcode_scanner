import { Injectable, Logger } from '@nestjs/common';
import archiver from 'archiver';
import * as fs from 'fs';
import * as path from 'path';
import { STORAGE_FAILED, STORAGE_ORIGINAL, STORAGE_PROCESSED } from '../../common/constants';

/**
 * Zip Service
 *
 * Creates memory-efficient streaming ZIP archives from processed images.
 * Uses Archiver with Node Streams — files are never fully loaded into memory.
 * Supports archives with 1,000,000+ files through streaming.
 */
@Injectable()
export class ZipService {
  private readonly logger = new Logger(ZipService.name);

  /**
   * Get the count of processed files available for download.
   */
  async getProcessedFileCount(): Promise<number> {
    try {
      const files = await fs.promises.readdir(STORAGE_PROCESSED);
      return files.filter((f) => !f.startsWith('.')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Get the count of original uploaded files available for download.
   */
  async getOriginalFileCount(): Promise<number> {
    try {
      const files = await fs.promises.readdir(STORAGE_ORIGINAL);
      return files.filter((f) => !f.startsWith('.')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Get the count of failed images available for download.
   */
  async getFailedFileCount(): Promise<number> {
    try {
      const files = await fs.promises.readdir(STORAGE_FAILED);
      return files.filter((f) => !f.startsWith('.')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Create a streaming ZIP archive of all processed images.
   *
   * IMPORTANT: This streams files — it does NOT load all images into memory.
   * Each file is read from disk and piped directly into the archive stream.
   * This makes it safe for extremely large batches (1M+ images).
   *
   * @returns An Archiver instance (readable stream) that can be piped to a response
   */
  createZipStream(): archiver.Archiver {
    const archive = archiver('zip', {
      zlib: { level: 1 }, // Fastest compression for image files (already compressed)
      highWaterMark: 1024 * 1024, // 1 MB buffer for high throughput
    });

    // Log archive progress
    archive.on('progress', (progress) => {
      if (progress.entries.processed % 1000 === 0 && progress.entries.processed > 0) {
        this.logger.log(
          `ZIP progress: ${progress.entries.processed} files archived`,
        );
      }
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        this.logger.warn(`ZIP warning: ${err.message}`);
      } else {
        throw err;
      }
    });

    // Add all files from the processed directory using streaming
    // archiver.directory() streams each file — it doesn't load them all at once
    archive.directory(STORAGE_PROCESSED, false);

    // Finalize the archive (no more files will be added)
    archive.finalize();

    this.logger.log('ZIP archive stream created and finalized');

    return archive;
  }

  /**
   * Create a streaming ZIP archive of all ORIGINAL uploaded images.
   */
  createOriginalZipStream(): archiver.Archiver {
    const archive = archiver('zip', {
      zlib: { level: 1 },
      highWaterMark: 1024 * 1024,
    });

    archive.on('progress', (progress) => {
      if (progress.entries.processed % 1000 === 0 && progress.entries.processed > 0) {
        this.logger.log(`Original ZIP progress: ${progress.entries.processed} files archived`);
      }
    });

    archive.on('warning', (err) => {
      if ((err as any).code === 'ENOENT') {
        this.logger.warn(`Original ZIP warning: ${err.message}`);
      } else {
        throw err;
      }
    });

    archive.directory(STORAGE_ORIGINAL, false);
    archive.finalize();

    this.logger.log('Original ZIP archive stream created and finalized');
    return archive;
  }

  /**
   * Create a streaming ZIP archive of all FAILED images (barcode detection failed).
   */
  createFailedZipStream(): archiver.Archiver {
    const archive = archiver('zip', {
      zlib: { level: 1 },
      highWaterMark: 1024 * 1024,
    });

    archive.on('progress', (progress) => {
      if (progress.entries.processed % 1000 === 0 && progress.entries.processed > 0) {
        this.logger.log(`Failed ZIP progress: ${progress.entries.processed} files archived`);
      }
    });

    archive.on('warning', (err) => {
      if ((err as any).code === 'ENOENT') {
        this.logger.warn(`Failed ZIP warning: ${err.message}`);
      } else {
        throw err;
      }
    });

    archive.directory(STORAGE_FAILED, false);
    archive.finalize();

    this.logger.log('Failed ZIP archive stream created and finalized');
    return archive;
  }
}


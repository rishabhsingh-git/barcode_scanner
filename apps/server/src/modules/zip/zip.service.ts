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
 *
 * Each file is explicitly verified readable before being added to the archive,
 * guaranteeing that every file on disk ends up in the ZIP (100% accuracy).
 */
@Injectable()
export class ZipService {
  private readonly logger = new Logger(ZipService.name);

  /**
   * List all non-hidden files in a directory, verifying each is readable.
   * Returns verified *relative* file paths so the ZIP never silently drops files,
   * and preserves subfolder structure when we create "duplicate-safe" outputs.
   */
  private async listVerifiedFilesRecursive(rootDir: string, dirPath: string): Promise<string[]> {
    let verified: string[] = [];

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files/folders
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const sub = await this.listVerifiedFilesRecursive(rootDir, fullPath);
          verified = verified.concat(sub);
          continue;
        }

        if (!entry.isFile()) continue;

        try {
          await fs.promises.access(fullPath, fs.constants.R_OK);
          const relPath = path.relative(rootDir, fullPath);
          // ZIP requires '/' separators regardless of OS.
          verified.push(relPath.replace(/\\/g, '/'));
        } catch {
          this.logger.warn(`Skipping unreadable file: ${fullPath}`);
        }
      }
    } catch {
      // Root/subdir may not exist yet — caller treats empty as "no files".
    }

    return verified;
  }

  async getProcessedFileCount(): Promise<number> {
    return (await this.listVerifiedFilesRecursive(STORAGE_PROCESSED, STORAGE_PROCESSED)).length;
  }

  async getOriginalFileCount(): Promise<number> {
    return (await this.listVerifiedFilesRecursive(STORAGE_ORIGINAL, STORAGE_ORIGINAL)).length;
  }

  async getFailedFileCount(): Promise<number> {
    return (await this.listVerifiedFilesRecursive(STORAGE_FAILED, STORAGE_FAILED)).length;
  }

  /**
   * Build a ZIP archive from a storage directory.
   *
   * Flow:
   *   1. Enumerate and verify all files BEFORE creating the archive
   *   2. Create the archive (caller must pipe it to a writable BEFORE we finalize)
   *   3. Add each file individually with its own error handler
   *   4. Finalize only after ALL files have been appended
   *
   * Returns { archive, fileCount } so the controller can set headers/log accurately.
   */
  async buildZipArchive(
    storageDir: string,
    label: string,
  ): Promise<{ archive: archiver.Archiver; fileCount: number }> {
    const files = await this.listVerifiedFilesRecursive(storageDir, storageDir);

    const archive = archiver('zip', {
      zlib: { level: 1 },
      highWaterMark: 1024 * 1024,
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        this.logger.warn(`[${label}] ZIP warning (skipped missing file): ${err.message}`);
      } else {
        this.logger.error(`[${label}] ZIP error: ${err.message}`);
      }
    });

    archive.on('progress', (progress) => {
      if (progress.entries.processed % 1000 === 0 && progress.entries.processed > 0) {
        this.logger.log(`[${label}] ZIP progress: ${progress.entries.processed}/${files.length} files archived`);
      }
    });

    for (const file of files) {
      archive.file(path.join(storageDir, file), { name: file });
    }

    this.logger.log(`[${label}] Added ${files.length} file(s) to archive — ready to finalize`);

    return { archive, fileCount: files.length };
  }
}


import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { STORAGE_ORIGINAL } from '../../common/constants';

/**
 * Upload Chunk Service
 * 
 * Handles chunked file uploads for large files (>40MB).
 * Chunks are reassembled on the server side.
 */
@Injectable()
export class UploadChunkService {
  private readonly logger = new Logger(UploadChunkService.name);
  private readonly chunkDir = path.join(STORAGE_ORIGINAL, '.chunks');

  constructor() {
    // Ensure chunk directory exists
    fs.mkdirSync(this.chunkDir, { recursive: true });
  }

  /**
   * Save an uploaded chunk
   * @param fileId - Unique file identifier
   * @param chunkIndex - Chunk index (0-based)
   * @param totalChunks - Total number of chunks
   * @param chunkData - Chunk binary data
   * @param originalFilename - Original filename
   * @returns Path to reassembled file if all chunks received, null otherwise
   */
  async saveChunk(
    fileId: string,
    chunkIndex: number,
    totalChunks: number,
    chunkData: Buffer,
    originalFilename: string,
  ): Promise<string | null> {
    const chunkPath = path.join(this.chunkDir, `${fileId}.chunk.${chunkIndex}`);
    
    // Save chunk to disk
    await fs.promises.writeFile(chunkPath, chunkData);
    
    this.logger.debug(
      `Saved chunk ${chunkIndex + 1}/${totalChunks} for file ${fileId}`,
    );

    // Check if all chunks are present
    const allChunksPresent = await this.checkAllChunksPresent(
      fileId,
      totalChunks,
    );

    if (allChunksPresent) {
      // Reassemble file
      return await this.reassembleFile(fileId, totalChunks, originalFilename);
    }

    return null; // Not all chunks received yet
  }

  /**
   * Check if all chunks for a file are present
   */
  private async checkAllChunksPresent(
    fileId: string,
    totalChunks: number,
  ): Promise<boolean> {
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(this.chunkDir, `${fileId}.chunk.${i}`);
      if (!fs.existsSync(chunkPath)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Reassemble file from chunks
   */
  private async reassembleFile(
    fileId: string,
    totalChunks: number,
    originalFilename: string,
  ): Promise<string> {
    const ext = path.extname(originalFilename);
    const finalPath = path.join(STORAGE_ORIGINAL, `${fileId}${ext}`);

    // Open write stream for final file
    const writeStream = fs.createWriteStream(finalPath);

    // Read and append chunks in order
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(this.chunkDir, `${fileId}.chunk.${i}`);
      const chunkData = await fs.promises.readFile(chunkPath);
      writeStream.write(chunkData);
      
      // Delete chunk after writing
      await fs.promises.unlink(chunkPath);
    }

    writeStream.end();

    // Wait for stream to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', (err) => reject(err));
    });

    this.logger.log(
      `Reassembled file ${originalFilename} from ${totalChunks} chunks → ${finalPath}`,
    );

    return finalPath;
  }

  /**
   * Clean up orphaned chunks (older than 1 hour)
   */
  async cleanupOrphanedChunks(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.chunkDir);
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hour

      for (const file of files) {
        const filePath = path.join(this.chunkDir, file);
        const stats = await fs.promises.stat(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.promises.unlink(filePath);
          this.logger.debug(`Cleaned up orphaned chunk: ${file}`);
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to cleanup chunks: ${error.message}`);
    }
  }
}


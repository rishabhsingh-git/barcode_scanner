import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadChunkService } from './upload-chunk.service';
import { UploadService } from './upload.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Upload Chunk Controller
 * 
 * Handles chunked file uploads for large files.
 * POST /upload/chunk - Upload a single chunk
 * 
 * IMPORTANT: Cropping happens AFTER upload (server-side), so we need to accept
 * the full original image size. Chunks are 10MB each, but with form fields
 * the total request can be ~15MB, so limits are set accordingly.
 */
@Controller('upload')
export class UploadChunkController {
  private readonly logger = new Logger(UploadChunkController.name);

  constructor(
    private readonly chunkService: UploadChunkService,
    private readonly uploadService: UploadService,
  ) {}

  @Post('chunk')
  @UseInterceptors(
    FileInterceptor('chunk', {
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB per chunk (increased to handle 10MB chunks + multipart overhead)
        fieldSize: 10 * 1024 * 1024, // 10MB for form fields (fileId, chunkIndex, etc.)
        fields: 10, // Max number of fields
        fieldNameSize: 256, // Max field name size
        files: 1, // Max number of files per request
        parts: 20, // Max number of parts in multipart form
        headerPairs: 2000, // Max header pairs
      },
      storage: {
        _handleFile: (req, file, cb) => {
          // Store chunk in memory as Buffer
          const chunks: Buffer[] = [];
          file.stream.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          file.stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            cb(null, {
              buffer,
              size: buffer.length,
            } as any);
          });
          file.stream.on('error', cb);
        },
        _removeFile: (_req, _file, cb) => {
          cb(null);
        },
      } as any,
    }),
  )
  async uploadChunk(
    @UploadedFile() chunk: Express.Multer.File,
    @Body('fileId') fileId: string,
    @Body('chunkIndex') chunkIndex: string,
    @Body('totalChunks') totalChunks: string,
    @Body('originalFilename') originalFilename: string,
  ) {
    // Log request details for debugging
    const contentLength = (chunk as any)?.size || 0;
    const sizeMB = (contentLength / (1024 * 1024)).toFixed(2);
    this.logger.log(`[Chunk Upload] Received request: fileId=${fileId}, chunkIndex=${chunkIndex}, totalChunks=${totalChunks}, filename=${originalFilename}, size=${sizeMB}MB`);
    
    if (!chunk) {
      this.logger.error('[Chunk Upload] No chunk file provided');
      this.logger.error(`[Chunk Upload] Request headers: ${JSON.stringify((chunk as any)?.headers || {})}`);
      throw new HttpException('No chunk provided', HttpStatus.BAD_REQUEST);
    }

    if (!fileId || !chunkIndex || !totalChunks || !originalFilename) {
      throw new HttpException(
        'Missing required fields: fileId, chunkIndex, totalChunks, originalFilename',
        HttpStatus.BAD_REQUEST,
      );
    }

    const chunkIdx = parseInt(chunkIndex, 10);
    const total = parseInt(totalChunks, 10);

    if (isNaN(chunkIdx) || isNaN(total) || chunkIdx < 0 || chunkIdx >= total) {
      throw new HttpException('Invalid chunk parameters', HttpStatus.BAD_REQUEST);
    }

    // Get chunk data from buffer or file path
    let chunkData: Buffer;
    if ((chunk as any).buffer) {
      chunkData = (chunk as any).buffer;
    } else if (chunk.path && fs.existsSync(chunk.path)) {
      chunkData = await fs.promises.readFile(chunk.path);
      await fs.promises.unlink(chunk.path).catch(() => {}); // Clean up temp file
    } else {
      throw new HttpException('Chunk data not found', HttpStatus.BAD_REQUEST);
    }

    this.logger.debug(
      `Received chunk ${chunkIdx + 1}/${total} for file ${fileId} (${chunkData.length} bytes)`,
    );

    // Save chunk and check if file is complete
    const finalPath = await this.chunkService.saveChunk(
      fileId,
      chunkIdx,
      total,
      chunkData,
      originalFilename,
    );

    if (finalPath) {
      // File is complete, enqueue for processing
      const mockFile = {
        originalname: originalFilename,
        path: finalPath,
        filename: path.basename(finalPath),
        mimetype: 'image/jpeg', // Will be validated later
        size: (await fs.promises.stat(finalPath)).size,
      } as Express.Multer.File;

      const result = await this.uploadService.enqueueFiles([mockFile]);

      return {
        message: 'File upload complete and queued for processing',
        complete: true,
        fileId,
        enqueuedCount: result.enqueuedCount,
        files: result.files,
      };
    }

    return {
      message: `Chunk ${chunkIdx + 1}/${total} uploaded successfully`,
      complete: false,
      fileId,
      chunkIndex: chunkIdx,
      totalChunks: total,
    };
  }
}


import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  Body,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FilesInterceptor, FileInterceptor, AnyFilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { STORAGE_ORIGINAL, STORAGE_CROPS } from '../../common/constants';
import { UploadService } from './upload.service';
import { UploadChunkService } from './upload-chunk.service';

/**
 * Upload Controller
 *
 * POST /upload — Accepts bulk image uploads via multipart form-data.
 * Files are saved to storage/original and enqueued for barcode processing.
 */
@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly chunkService: UploadChunkService,
  ) {}

  // IMPORTANT: Specific route must come BEFORE generic route
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
          const chunks: Buffer[] = [];
          file.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          file.stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            cb(null, {
              buffer,
              size: buffer.length,
              fieldname: file.fieldname,
              originalname: file.originalname,
              encoding: file.encoding,
              mimetype: file.mimetype,
            } as any);
          });
          file.stream.on('error', (err) => cb(err));
        },
        _removeFile: (_req, _file, cb) => cb(null),
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
    this.logger.log(`[Chunk Upload] Received: fileId=${fileId}, chunkIndex=${chunkIndex}, totalChunks=${totalChunks}, filename=${originalFilename}`);
    
    if (!chunk) {
      this.logger.error('[Chunk Upload] No chunk file provided');
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
      await fs.promises.unlink(chunk.path).catch(() => {});
    } else {
      throw new HttpException('Chunk data not found', HttpStatus.BAD_REQUEST);
    }

    this.logger.debug(`[Chunk Upload] Received chunk ${chunkIdx + 1}/${total} for file ${fileId} (${chunkData.length} bytes)`);

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
        mimetype: 'image/jpeg',
        size: (await fs.promises.stat(finalPath)).size,
      } as Express.Multer.File;

      const result = await this.uploadService.enqueueFiles([mockFile]);

      this.logger.log(`[Chunk Upload] File ${originalFilename} reassembled and queued for processing`);

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

  /**
   * POST /upload/with-crops
   * 
   * Accepts images with manually cropped barcode regions.
   * Uploads both original full images and their corresponding cropped barcodes.
   * Maintains strong relationship between originals and crops.
   */
  @Post('with-crops')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: diskStorage({
        destination: (req, file, cb) => {
          // Route files to different directories based on fieldname
          if (file.fieldname === 'originals') {
            cb(null, STORAGE_ORIGINAL);
          } else if (file.fieldname === 'crops') {
            // Ensure crops directory exists
            if (!fs.existsSync(STORAGE_CROPS)) {
              fs.mkdirSync(STORAGE_CROPS, { recursive: true });
            }
            cb(null, STORAGE_CROPS);
          } else {
            cb(new Error(`Unknown field name: ${file.fieldname}`), '');
          }
        },
        filename: (req, file, cb) => {
          if (file.fieldname === 'originals') {
            const ext = path.extname(file.originalname);
            const uniqueName = `${uuidv4()}${ext}`;
            cb(null, uniqueName);
          } else if (file.fieldname === 'crops') {
            const uniqueName = `${uuidv4()}.jpg`;
            cb(null, uniqueName);
          } else {
            cb(new Error(`Unknown field name: ${file.fieldname}`), '');
          }
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(
            new HttpException(
              `File ${file.originalname} is not an image`,
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
        
        // Validate crop files are small (should be < 1MB)
        if (file.fieldname === 'crops' && file.size > 1024 * 1024) {
          return cb(
            new HttpException(
              `Crop file ${file.originalname} is too large (${(file.size / 1024).toFixed(2)} KB). Crop files should be small (< 1MB).`,
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
        
        cb(null, true);
      },
      limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB per file (for originals)
        files: 20000, // Allow both originals and crops
        fieldSize: 10 * 1024 * 1024, // 10 MB for other fields
      },
    }),
  )
  async uploadImagesWithCrops(
    @UploadedFiles() allFiles: Express.Multer.File[],
    @Body('mapping') mappingJson?: string,
  ) {
    // Separate files by fieldname
    const originals = allFiles.filter(f => f.fieldname === 'originals');
    const crops = allFiles.filter(f => f.fieldname === 'crops');
    if (!originals || originals.length === 0) {
      throw new HttpException('No original images provided', HttpStatus.BAD_REQUEST);
    }

    if (!crops || crops.length === 0) {
      throw new HttpException('No crop images provided', HttpStatus.BAD_REQUEST);
    }

    if (originals.length !== crops.length) {
      throw new HttpException(
        `Mismatch: ${originals.length} originals but ${crops.length} crops`,
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(
      `[With Crops] Received ${originals.length} original(s) and ${crops.length} crop(s)`,
    );

    // Parse mapping if provided (for robust relationship maintenance)
    let mapping: Array<{ originalIndex: number; originalName: string; cropIndex: number }> = [];
    if (mappingJson) {
      try {
        mapping = JSON.parse(mappingJson);
        this.logger.debug(`[With Crops] Mapping received: ${mapping.length} pairs`);
      } catch (error) {
        this.logger.warn(`[With Crops] Failed to parse mapping JSON: ${error}`);
      }
    }

    // Ensure crops directory exists
    if (!fs.existsSync(STORAGE_CROPS)) {
      await fs.promises.mkdir(STORAGE_CROPS, { recursive: true });
      this.logger.log(`[With Crops] Created crops directory: ${STORAGE_CROPS}`);
    }

    // Pair originals with crops (maintains strong relationship)
    // Strategy: Use array index pairing (Multer preserves order within fieldname)
    // The frontend sends originals[0], crops[0], originals[1], crops[1] in order,
    // and Multer preserves this order, so index pairing is reliable.
    const pairedFiles: Array<{
      original: Express.Multer.File;
      crop: Express.Multer.File;
    }> = [];

    // Verify mapping if provided (for debugging and validation)
    if (mapping.length > 0 && mapping.length === originals.length) {
      this.logger.debug(
        `[With Crops] Mapping validation: ${mapping.length} entries match ${originals.length} files`,
      );
      // Validate that mapping matches actual files
      for (let i = 0; i < mapping.length; i++) {
        const mapEntry = mapping[i];
        const original = originals[i];
        if (original && original.originalname !== mapEntry.originalName) {
          this.logger.warn(
            `[With Crops] Mapping mismatch at index ${i}: expected ${mapEntry.originalName}, got ${original.originalname}`,
          );
        }
      }
    }

    // Pair by array index (Multer preserves order, so this is reliable)
    // Use mapping JSON if available for more robust pairing (fallback to index)
    const useMapping = mapping.length > 0 && mapping.length === originals.length;
    
    if (useMapping) {
      // Pair using mapping (more robust - matches by filename)
      for (const mapEntry of mapping) {
        const original = originals.find(f => f.originalname === mapEntry.originalName);
        const cropIndex = mapEntry.cropIndex;
        
        if (original && cropIndex >= 0 && cropIndex < crops.length) {
          pairedFiles.push({
            original,
            crop: crops[cropIndex],
          });
          this.logger.verbose(
            `[With Crops] Paired via mapping: ${original.originalname} ↔ ${crops[cropIndex].filename}`,
          );
        } else {
          this.logger.warn(
            `[With Crops] Mapping entry failed: original=${mapEntry.originalName}, cropIndex=${cropIndex}`,
          );
        }
      }
      
      // If mapping pairing incomplete, fall back to index pairing
      if (pairedFiles.length !== originals.length) {
        this.logger.warn(
          `[With Crops] Mapping pairing incomplete (${pairedFiles.length}/${originals.length}), falling back to index pairing`,
        );
        pairedFiles.length = 0; // Clear and retry
      }
    }
    
    // Index-based pairing (default or fallback)
    if (pairedFiles.length === 0) {
      for (let i = 0; i < originals.length; i++) {
        if (i < crops.length) {
          pairedFiles.push({
            original: originals[i],
            crop: crops[i],
          });
          this.logger.verbose(
            `[With Crops] Paired by index: ${originals[i].originalname} ↔ ${crops[i].filename}`,
          );
        } else {
          this.logger.error(
            `[With Crops] Missing crop for original ${i}: ${originals[i].originalname}`,
          );
          throw new HttpException(
            `Missing crop for original image ${i + 1}: ${originals[i].originalname}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    this.logger.log(
      `[With Crops] Paired ${pairedFiles.length} original-crop pairs for processing`,
    );

    // Enqueue files with crop information
    const result = await this.uploadService.enqueueFilesWithCrops(pairedFiles);

    this.logger.log(
      `[With Crops] Successfully enqueued ${result.enqueuedCount} job(s) with cropped barcodes`,
    );

    return {
      message: `${result.enqueuedCount} image(s) with cropped barcodes uploaded and queued for processing`,
      enqueuedCount: result.enqueuedCount,
      files: result.files,
    };
  }

  @Post()
  @UseInterceptors(
    FilesInterceptor('images', 10000, {
      storage: diskStorage({
        destination: STORAGE_ORIGINAL,
        filename: (_req, file, cb) => {
          // Preserve original extension, use UUID to avoid name collisions
          const ext = path.extname(file.originalname);
          const uniqueName = `${uuidv4()}${ext}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (_req, file, cb) => {
        // Only accept image files
        if (!file.mimetype.startsWith('image/')) {
          return cb(
            new HttpException(
              `File ${file.originalname} is not an image`,
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB per file (larger files use chunked upload)
        files: 10000, // Max number of files
        fieldSize: 10 * 1024 * 1024, // 10 MB for other fields
      },
    }),
  )
  async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new HttpException('No images provided', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`Received ${files.length} image(s) for upload`);

    const result = await this.uploadService.enqueueFiles(files);

    this.logger.log(
      `Successfully enqueued ${result.enqueuedCount} job(s) for processing`,
    );

    return {
      message: `${result.enqueuedCount} image(s) uploaded and queued for processing`,
      enqueuedCount: result.enqueuedCount,
      files: result.files,
    };
  }
}


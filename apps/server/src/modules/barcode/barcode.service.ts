import { Injectable, Logger } from '@nestjs/common';
// OpenAI code kept aside - not used but available
// import {
//   detectBarcodeWithOpenAI,
//   detectBarcodesInChunks,
//   openaiConfig,
//   ChunkResult,
// } from '../../common/openai-client';
// Dynamsoft code removed - using Python script instead
import * as childProcess from 'child_process';
import { promisify } from 'util';
import { GoogleVisionClient } from '../../common/google-vision-client';
const execFile = promisify(childProcess.execFile);

/**
 * Barcode Service
 *
 * Uses Dynamsoft Python SDK (via detect_barcode.py) to read barcode numbers from images.
 * Automatically crops images to top 30% before scanning for better performance.
 */
@Injectable()
export class BarcodeService {
  private readonly logger = new Logger(BarcodeService.name);

  constructor(private readonly googleVision: GoogleVisionClient) {
    this.logger.log(
      `BarcodeService initialised — Using Dynamsoft Python SDK with Google Vision fallback`,
    );
  }

  /**
   * Detect a barcode from a single image file on disk.
   * Tries Dynamsoft Python SDK first, falls back to Google Vision API if available.
   *
   * @param filePath - Absolute path to the image file
   * @returns The barcode text value, or null if detection fails
   */
  async detectBarcode(filePath: string): Promise<string | null> {
    try {
      this.logger.verbose(`Detecting barcode: ${filePath}`);
      
      // Try Dynamsoft Python SDK first
      const scriptPath = '/app/scripts/detect_barcode.py';
      try {
        const { stdout } = await execFile('python3', [scriptPath, filePath]);
        const result = stdout.trim();
        
        // STRICT VALIDATION: Only accept 8-21 digits (prevents reading filenames)
        if (result && result.length >= 8 && result.length <= 21) {
          this.logger.verbose(`Barcode found (Dynamsoft): ${result} (${filePath})`);
          return result;
        } else if (result) {
          this.logger.warn(`Dynamsoft returned invalid length: ${result.length} digits (expected 8-21). Value: ${result}`);
        }
      } catch (error: any) {
        this.logger.debug(`Dynamsoft detection failed: ${error.message}`);
      }
      
      // Fallback to Google Vision API if available
      this.logger.log(`Dynamsoft failed, trying Google Vision API fallback...`);
      const googleResult = await this.googleVision.detectBarcode(filePath);
      if (googleResult) {
        this.logger.log(`✅ Barcode found (Google Vision): ${googleResult} (${filePath})`);
        return googleResult;
      }
      
      this.logger.warn(`❌ No valid barcode found in image (tried Dynamsoft + Google Vision): ${filePath}`);
      return null;
    } catch (error: any) {
      this.logger.error(
        `Barcode detection error for ${filePath}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Detect barcodes from multiple images.
   * Processes them sequentially using Python script.
   *
   * @param filePaths   Array of absolute image file paths
   * @returns           Array of results with barcode values
   */
  async detectBarcodes(filePaths: string[]): Promise<Array<{ filePath: string; barcodeValue: string | null; error?: string }>> {
    this.logger.log(`Batch barcode detection: ${filePaths.length} images`);

    const results = await Promise.all(
      filePaths.map(async (fp) => {
        try {
          const scriptPath = '/app/scripts/detect_barcode.py';
          const { stdout } = await execFile('python3', [scriptPath, fp]);
          const barcodeValue = stdout.trim();
          // Validate barcode (8-30 digits)
          const validBarcode = (barcodeValue && barcodeValue.length >= 8 && barcodeValue.length <= 30) 
            ? barcodeValue 
            : null;
          return { filePath: fp, barcodeValue: validBarcode };
        } catch (err: any) {
          return {
            filePath: fp,
            barcodeValue: null,
            error: err.message,
          };
        }
      }),
    );

    const found = results.filter((r) => r.barcodeValue !== null).length;
    this.logger.log(
      `Batch complete: ${found}/${results.length} barcodes detected`,
    );

    return results;
  }
}

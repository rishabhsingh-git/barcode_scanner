/**
 * Google Cloud Vision API Client
 * Provides barcode detection using Google Vision API as an alternative/fallback
 * to Dynamsoft Python SDK
 */

import { Injectable, Logger } from '@nestjs/common';
import * as vision from '@google-cloud/vision';
import * as fs from 'fs';

@Injectable()
export class GoogleVisionClient {
  private readonly logger = new Logger(GoogleVisionClient.name);
  private client: vision.ImageAnnotatorClient | null = null;
  private initialized = false;

  /**
   * Initialize Google Vision client
   * Requires GOOGLE_APPLICATION_CREDENTIALS environment variable
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('Google Vision client already initialized');
      return;
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  [Google Vision] ── Initialization ──');
    
    try {
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      
      console.log(`  [Google Vision] Checking credentials...`);
      console.log(`  [Google Vision] GOOGLE_APPLICATION_CREDENTIALS: ${credentialsPath || 'NOT SET'}`);
      
      if (!credentialsPath) {
        console.log(`  [Google Vision] ⚠ GOOGLE_APPLICATION_CREDENTIALS not set`);
        console.log(`  [Google Vision] ⚠ Google Vision API will be DISABLED`);
        console.log(`  [Google Vision] ⚠ To enable: Set GOOGLE_APPLICATION_CREDENTIALS environment variable`);
        this.logger.warn(
          'GOOGLE_APPLICATION_CREDENTIALS not set. Google Vision API disabled.',
        );
        this.initialized = true; // Mark as initialized to prevent retries
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        return;
      }

      console.log(`  [Google Vision] Checking if credentials file exists...`);
      if (!fs.existsSync(credentialsPath)) {
        console.log(`  [Google Vision] ❌ Credentials file NOT FOUND: ${credentialsPath}`);
        console.log(`  [Google Vision] ⚠ Google Vision API will be DISABLED`);
        this.logger.warn(
          `Google Vision credentials file not found: ${credentialsPath}. Google Vision API disabled.`,
        );
        this.initialized = true;
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        return;
      }

      console.log(`  [Google Vision] ✓ Credentials file found: ${credentialsPath}`);
      
      // Check file size
      const stats = fs.statSync(credentialsPath);
      console.log(`  [Google Vision] Credentials file size: ${stats.size} bytes`);
      
      // Try to read and validate JSON
      try {
        const credsContent = fs.readFileSync(credentialsPath, 'utf8');
        const creds = JSON.parse(credsContent);
        console.log(`  [Google Vision] ✓ Credentials file is valid JSON`);
        console.log(`  [Google Vision] Project ID: ${creds.project_id || 'NOT FOUND'}`);
        console.log(`  [Google Vision] Client Email: ${creds.client_email || 'NOT FOUND'}`);
      } catch (parseError: any) {
        console.log(`  [Google Vision] ⚠ Warning: Could not parse credentials JSON: ${parseError.message}`);
      }

      console.log(`  [Google Vision] Creating ImageAnnotatorClient...`);
      this.client = new vision.ImageAnnotatorClient({
        keyFilename: credentialsPath,
      });

      this.initialized = true;
      console.log(`  [Google Vision] ✅ Client initialized successfully`);
      this.logger.log('Google Vision API client initialized successfully');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
    } catch (error: any) {
      console.log(`  [Google Vision] ❌ Initialization FAILED`);
      console.log(`  [Google Vision] Error: ${error.message}`);
      if (error.stack) {
        console.log(`  [Google Vision] Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
      }
      this.logger.error(
        `Failed to initialize Google Vision API: ${error.message}`,
      );
      this.initialized = true; // Mark as initialized to prevent infinite retries
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
    }
  }

  /**
   * Detect barcode from image file using Google Vision API
   * 
   * @param imagePath - Absolute path to the image file
   * @returns Barcode value (digits only) or null if not found
   */
  async detectBarcode(imagePath: string): Promise<string | null> {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  [Google Vision] Starting barcode detection');
    console.log(`  [Google Vision] Image path: ${imagePath}`);
    
    await this.initialize();

    if (!this.client) {
      console.log(`  [Google Vision] ⚠ Client not available (credentials not configured)`);
      console.log(`  [Google Vision] Skipping Google Vision detection`);
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      this.logger.debug('Google Vision client not available');
      return null;
    }

    if (!fs.existsSync(imagePath)) {
      console.log(`  [Google Vision] ❌ Image file not found: ${imagePath}`);
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      this.logger.error(`Image not found: ${imagePath}`);
      return null;
    }

    const stats = fs.statSync(imagePath);
    const imageSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`  [Google Vision] ✓ Image file exists (${stats.size} bytes, ${imageSizeMB} MB)`);

    const overallStartTime = Date.now();
    let barcodeTime = 0;
    let textTime = 0;
    
    try {
      // Try barcode detection first
      console.log(`  [Google Vision] Step 1: Attempting BARCODE_DETECTION...`);
      const barcodeStartTime = Date.now();
      
      const [barcodeResult] = await this.client.annotateImage({
        image: { source: { filename: imagePath } },
        features: [{ type: 'BARCODE_DETECTION' }],
      });
      
      barcodeTime = Date.now() - barcodeStartTime;
      console.log(`  [Google Vision] ✓ Barcode detection API call completed (${barcodeTime}ms)`);
      
      const barcodes = (barcodeResult as any).barcodeAnnotations || [];
      console.log(`  [Google Vision] Found ${barcodes.length} barcode annotation(s)`);

      if (barcodes.length > 0) {
        // Get first valid barcode
        for (let i = 0; i < barcodes.length; i++) {
          const barcode = barcodes[i];
          const value = barcode.rawValue?.trim();
          const format = barcode.format || 'UNKNOWN';
          
          // Get bounding box location
          const boundingBox = (barcode as any).boundingPoly?.vertices;
          let bboxInfo = '';
          if (boundingBox && boundingBox.length > 0) {
            const xCoords = boundingBox.map((v: any) => v.x || 0).filter((x: number) => x > 0);
            const yCoords = boundingBox.map((v: any) => v.y || 0).filter((y: number) => y > 0);
            if (xCoords.length > 0 && yCoords.length > 0) {
              const minX = Math.min(...xCoords);
              const minY = Math.min(...yCoords);
              const maxX = Math.max(...xCoords);
              const maxY = Math.max(...yCoords);
              const width = maxX - minX;
              const height = maxY - minY;
              bboxInfo = `Location: x=${minX}, y=${minY}, width=${width}, height=${height}`;
            }
          }
          
          console.log(`  [Google Vision] Barcode ${i + 1}:`);
          console.log(`    - Format: ${format}`);
          console.log(`    - Raw value: ${value || 'N/A'}`);
          if (bboxInfo) {
            console.log(`    - ${bboxInfo}`);
          }
          
          if (value) {
            // Extract only digits
            const cleaned = value.replace(/\D/g, '');
            console.log(`    - Cleaned (digits only): ${cleaned}`);
            console.log(`    - Length: ${cleaned.length} digits`);
            
            // STRICT VALIDATION: Most barcodes are 8-21 digits
            // Reject longer sequences (likely filenames or concatenated text)
            if (cleaned.length >= 8 && cleaned.length <= 21) {
              // Additional validation: EAN-13/UPC-A checksum
              let isValidChecksum = true;
              if (cleaned.length === 13 || cleaned.length === 12) {
                const digits = cleaned.split('').map(Number);
                const checksum = digits[digits.length - 1];
                let total = 0;
                
                for (let i = 0; i < digits.length - 1; i++) {
                  total += digits[i] * (i % 2 === 0 ? 1 : 3);
                }
                
                const calculatedChecksum = (10 - (total % 10)) % 10;
                isValidChecksum = calculatedChecksum === checksum;
                
                if (!isValidChecksum) {
                  console.log(`    - ⚠ Checksum validation FAILED (expected: ${calculatedChecksum}, got: ${checksum})`);
                }
              }
              
              if (isValidChecksum) {
                console.log(`  [Google Vision] ✅ VALID BARCODE FOUND: ${cleaned}`);
                if (cleaned.length === 13 || cleaned.length === 12) {
                  console.log(`    - ✅ Checksum validation: PASSED`);
                }
                if (bboxInfo) {
                  console.log(`  [Google Vision] 📍 Barcode location: ${bboxInfo}`);
                }
                const totalTime = Date.now() - overallStartTime;
                console.log(`  [Google Vision] Total time: ${totalTime}ms (barcode: ${barcodeTime}ms, text: skipped)`);
                this.logger.log(
                  `Google Vision detected barcode: ${cleaned} (format: ${format})`,
                );
                console.log('═══════════════════════════════════════════════════════════');
                console.log('');
                return cleaned;
              } else {
                console.log(`    - ⚠ Barcode failed checksum validation - likely misread`);
              }
            } else {
              console.log(`    - ⚠ Invalid length (need 8-21 digits, got ${cleaned.length}) - likely filename or other text`);
            }
          }
        }
      }

      // Fallback: Try text detection ONLY if barcode detection found nothing
      // This saves ~500-1000ms if barcode was already found
      console.log(`  [Google Vision] Step 2: No valid barcode found, trying TEXT_DETECTION...`);
      const textStartTime = Date.now();
      
      const [textResult] = await this.client.annotateImage({
        image: { source: { filename: imagePath } },
        features: [{ type: 'TEXT_DETECTION' }],
      });
      
      textTime = Date.now() - textStartTime;
      console.log(`  [Google Vision] ✓ Text detection API call completed (${textTime}ms)`);
      
      const detections = (textResult as any).textAnnotations || [];
      console.log(`  [Google Vision] Found ${detections.length} text annotation(s)`);

      if (detections.length > 0) {
        // Look for text that appears BELOW the barcode (typically shorter, cleaner numbers)
        // CRITICAL: We want ONLY the numbers below the barcode lines, not filenames or headers
        // Strategy: Look for text annotations that are positioned in the middle-lower region
        // and have reasonable barcode lengths (8-21 digits)
        
        const candidateNumbers: Array<{ 
          text: string; 
          cleaned: string; 
          length: number;
          boundingBox?: any;
          yPosition?: number;
        }> = [];
        
        for (let i = 0; i < detections.length; i++) {
          const detection = detections[i];
          const text = detection.description?.trim();
          
          if (text) {
            // Extract only digits
            const cleaned = text.replace(/\D/g, '');
            
            // Get bounding box to determine position (if available)
            const boundingBox = (detection as any).boundingPoly?.vertices;
            let yPosition: number | null = null;
            if (boundingBox && boundingBox.length > 0) {
              // Calculate average Y position
              const yValues = boundingBox.map((v: any) => v.y || 0).filter((y: number) => y > 0);
              yPosition = yValues.length > 0 ? yValues.reduce((a: number, b: number) => a + b, 0) / yValues.length : null;
            }
            
            // STRICT FILTERING:
            // 1. Must be reasonable barcode length (8-21 digits)
            // 2. Must NOT be too long (reject filenames which are usually 20+ digits)
            // 3. Prefer sequences that are in the middle-lower part of image (where numbers below barcode are)
            
            if (cleaned.length >= 8 && cleaned.length <= 21) {
              // Additional validation: Check if it looks like a barcode number
              // Barcode numbers are usually continuous digits without excessive length
              // Filenames often have patterns like "4502466420355752611000005" (25+ digits)
              
              // Reject if it's suspiciously long or contains patterns that suggest filename
              const isLikelyFilename = cleaned.length > 22 || 
                                       (cleaned.length > 20 && cleaned.startsWith('4') && cleaned[1] === '5');
              
              if (!isLikelyFilename) {
                candidateNumbers.push({ 
                  text, 
                  cleaned, 
                  length: cleaned.length,
                  boundingBox,
                  yPosition: yPosition || 0
                });
                console.log(`  [Google Vision] Text ${i + 1}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
                console.log(`    - Extracted digits: ${cleaned} (length: ${cleaned.length})`);
                if (yPosition !== null) {
                  console.log(`    - Y position: ${yPosition.toFixed(0)} (lower = closer to numbers below barcode)`);
                }
              } else {
                console.log(`  [Google Vision] Text ${i + 1}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
                console.log(`    - ⚠ Rejected: Likely filename or header text (length: ${cleaned.length}, pattern detected)`);
              }
            } else if (cleaned.length > 0) {
              console.log(`  [Google Vision] Text ${i + 1}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
              console.log(`    - ⚠ Rejected: length ${cleaned.length} not in range 8-21 (likely filename or other text)`);
            }
          }
        }
        
        // Sort by:
        // 1. Length (shorter first - actual barcode numbers are usually 12-18 digits)
        // 2. Y position (lower first - numbers below barcode are lower in image)
        candidateNumbers.sort((a, b) => {
          // First prioritize by length (prefer 12-18 digits)
          const aLengthScore = Math.abs(a.length - 15); // Closer to 15 is better
          const bLengthScore = Math.abs(b.length - 15);
          if (Math.abs(aLengthScore - bLengthScore) > 2) {
            return aLengthScore - bLengthScore;
          }
          // Then by Y position (lower is better - numbers below barcode)
          const aY = (a.yPosition !== null && a.yPosition !== undefined) ? a.yPosition : 0;
          const bY = (b.yPosition !== null && b.yPosition !== undefined) ? b.yPosition : 0;
          return aY - bY;
        });
        
        if (candidateNumbers.length > 0) {
          // Take the shortest valid candidate (most likely to be the barcode number)
          const bestMatch = candidateNumbers[0];
          console.log(`  [Google Vision] ✅ VALID BARCODE FOUND VIA TEXT: ${bestMatch.cleaned}`);
          console.log(`  [Google Vision] Selected shortest candidate (length: ${bestMatch.length})`);
          this.logger.log(
            `Google Vision detected barcode via text: ${bestMatch.cleaned}`,
          );
          console.log('═══════════════════════════════════════════════════════════');
          console.log('');
          return bestMatch.cleaned;
        }
      }

      console.log(`  [Google Vision] ❌ No valid barcode found`);
      console.log(`  [Google Vision] Total API calls: 2 (barcode + text)`);
      const totalTime = Date.now() - overallStartTime;
      console.log(`  [Google Vision] Total time: ${totalTime}ms (barcode: ${barcodeTime}ms, text: ${textTime}ms)`);
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      this.logger.debug('No barcode found with Google Vision');
      return null;
    } catch (error: any) {
      console.log(`  [Google Vision] ❌ ERROR during detection`);
      console.log(`  [Google Vision] Error type: ${error.constructor.name}`);
      console.log(`  [Google Vision] Error message: ${error.message}`);
      if (error.code) {
        console.log(`  [Google Vision] Error code: ${error.code}`);
      }
      if (error.stack) {
        console.log(`  [Google Vision] Stack trace:`);
        console.log(error.stack.split('\n').slice(0, 5).map((line: string) => `    ${line}`).join('\n'));
      }
      this.logger.error(
        `Google Vision barcode detection failed: ${error.message}`,
      );
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      return null;
    }
  }

  /**
   * Check if Google Vision API is available
   */
  async isAvailable(): Promise<boolean> {
    await this.initialize();
    return this.client !== null;
  }
}


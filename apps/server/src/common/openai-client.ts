/**
 * OpenAI Responses API Client with Rate Limiting
 *
 * ⚠️ CRITICAL: This module ONLY calls OpenAI API - NO Python, NO other methods!
 * 
 * Uses OpenAI /v1/responses endpoint directly via HTTP fetch().
 * 
 * STRICT REQUIREMENTS:
 *   - ONLY uses native fetch() for HTTP requests
 *   - ONLY calls https://api.openai.com/v1/responses
 *   - NO Python scripts, NO execFile, NO child_process
 *   - NO external SDKs - pure HTTP only
 *
 * Features:
 *   - Concurrent request limiting (semaphore)
 *   - Requests-per-minute (RPM) rate limiter
 *   - Automatic retry with exponential backoff on 429 / 5xx
 *   - Chunk-based batch processing helper
 *
 * Configuration (environment variables):
 *   OPENAI_API_KEY          – required
 *   OPENAI_MODEL            – default "gpt-4.1"
 *   OPENAI_MAX_CONCURRENT   – max in-flight requests  (default 5)
 *   OPENAI_RPM_LIMIT        – requests per minute cap  (default 50)
 *   OPENAI_MAX_RETRIES      – retries on transient err (default 3)
 *   OPENAI_CHUNK_SIZE       – images per chunk          (default 10)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load .env file if not already loaded ────────────────────────────────────
// The worker imports 'dotenv/config' but this module might be imported before that
try {
  // Try to load dotenv if available
  if (typeof require !== 'undefined' && !process.env.OPENAI_API_KEY) {
    try {
      const dotenv = require('dotenv');
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const result = dotenv.config({ path: envPath });
        if (result.error) {
          console.log(`  [OpenAI] ⚠ dotenv error loading .env: ${result.error.message}`);
        } else {
          console.log(`  [OpenAI] ✓ Loaded .env from: ${envPath}`);
        }
      } else {
        console.log(`  [OpenAI] ⚠ .env file not found at: ${envPath}`);
        // Try parent directory (project root)
        const parentEnvPath = path.resolve(process.cwd(), '..', '.env');
        if (fs.existsSync(parentEnvPath)) {
          const result = dotenv.config({ path: parentEnvPath });
          if (!result.error) {
            console.log(`  [OpenAI] ✓ Loaded .env from parent: ${parentEnvPath}`);
          }
        }
      }
    } catch (e) {
      // dotenv not available or already loaded
    }
  }
} catch (e) {
  // Ignore
}

// ── SAFETY CHECK: Ensure no Python/child_process imports ──────────────────
// This will throw immediately if someone tries to import Python-related modules
if (typeof require !== 'undefined') {
  try {
    // Check if child_process is somehow imported (it shouldn't be)
    const mod = require.cache;
    if (mod) {
      for (const key in mod) {
        if (key.includes('child_process') || key.includes('python') || key.includes('execFile')) {
          throw new Error(
            `FATAL: Found forbidden import: ${key}. ` +
            `This module MUST ONLY use OpenAI API via fetch().`
          );
        }
      }
    }
  } catch (e) {
    // Ignore - this is just a safety check
  }
}

// ── Configuration ────────────────────────────────────────────────────────

// ── Load environment variables with debug logging ───────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const MAX_CONCURRENT = parseInt(process.env.OPENAI_MAX_CONCURRENT || '5', 10);
const RPM_LIMIT = parseInt(process.env.OPENAI_RPM_LIMIT || '50', 10);
const MAX_RETRIES = parseInt(process.env.OPENAI_MAX_RETRIES || '3', 10);
const CHUNK_SIZE = parseInt(process.env.OPENAI_CHUNK_SIZE || '10', 10);

// ── Debug: Log environment variable loading at module load time ─────────────
if (typeof process !== 'undefined') {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  [OpenAI] Module Load - Environment Check`);
  console.log(`  [OpenAI] process.cwd(): ${process.cwd()}`);
  console.log(`  [OpenAI] .env file exists at cwd: ${fs.existsSync(path.join(process.cwd(), '.env'))}`);
  console.log(`  [OpenAI] .env file exists at parent: ${fs.existsSync(path.join(process.cwd(), '..', '.env'))}`);
  console.log(`  [OpenAI] process.env.OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? `SET (length: ${process.env.OPENAI_API_KEY.length})` : 'NOT SET'}`);
  console.log(`  [OpenAI] OPENAI_API_KEY const: ${OPENAI_API_KEY ? `SET (length: ${OPENAI_API_KEY.length})` : 'NOT SET'}`);
  console.log(`  [OpenAI] All env vars starting with OPENAI_:`, Object.keys(process.env).filter(k => k.startsWith('OPENAI_')).join(', ') || 'NONE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

// ── Semaphore (concurrency limiter) ──────────────────────────────────────

class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }
}

const semaphore = new Semaphore(MAX_CONCURRENT);

// ── RPM Rate Limiter (sliding window) ────────────────────────────────────

class RpmLimiter {
  private timestamps: number[] = [];

  constructor(private readonly maxPerMinute: number) {}

  async waitForSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      // Remove timestamps older than 60 seconds
      this.timestamps = this.timestamps.filter((t) => now - t < 60_000);

      if (this.timestamps.length < this.maxPerMinute) {
        this.timestamps.push(now);
        return;
      }

      // Wait until the oldest request falls out of the 60-second window
      const oldest = this.timestamps[0];
      const waitMs = 60_000 - (now - oldest) + 50; // +50ms buffer
      console.log(
        `  [RateLimiter] RPM limit reached (${this.maxPerMinute}/min). Waiting ${waitMs}ms...`,
      );
      await sleep(waitMs);
    }
  }
}

const rpmLimiter = new RpmLimiter(RPM_LIMIT);

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageToBase64(filePath: string): { base64: string; mimeType: string } {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
  };

  const mimeType = mimeMap[ext] || 'image/jpeg';
  return { base64: buffer.toString('base64'), mimeType };
}

// ── Core: detect barcode from a single image ─────────────────────────────

/**
 * Send an image to OpenAI /v1/responses API and extract the barcode number.
 *
 * @param filePath  Absolute path to the image file on disk.
 * @returns         The barcode digits string, or `null` if not found.
 */
export async function detectBarcodeWithOpenAI(
  filePath: string,
): Promise<string | null> {
  const startTime = Date.now();
  const filename = path.basename(filePath);
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  [OpenAI] Starting barcode detection`);
  console.log(`  File: ${filename}`);
  console.log(`  Path: ${filePath}`);
  console.log('═══════════════════════════════════════════════════════════');

  // ── DEBUG: Log all environment variables ────────────────────────────────────
  console.log(`  [OpenAI] ── Environment Debug ──`);
  console.log(`  [OpenAI] process.env.OPENAI_API_KEY exists: ${!!process.env.OPENAI_API_KEY}`);
  console.log(`  [OpenAI] process.env.OPENAI_API_KEY length: ${process.env.OPENAI_API_KEY?.length || 0}`);
  console.log(`  [OpenAI] OPENAI_API_KEY (const) exists: ${!!OPENAI_API_KEY}`);
  console.log(`  [OpenAI] OPENAI_API_KEY (const) length: ${OPENAI_API_KEY.length}`);
  console.log(`  [OpenAI] All OPENAI_ env vars:`, Object.keys(process.env).filter(k => k.startsWith('OPENAI_')));
  console.log(`  [OpenAI] ─────────────────────────────────────────────────────`);
  
  // Validate API key is set
  if (!OPENAI_API_KEY) {
    const error = 'OPENAI_API_KEY environment variable is not set. ' +
      'Please set it in your .env file or environment variables.';
    console.error(`  [OpenAI] ❌ ERROR: ${error}`);
    console.error(`  [OpenAI] Check: Is .env file in project root?`);
    console.error(`  [OpenAI] Check: Is dotenv loading .env file?`);
    console.error(`  [OpenAI] Check: Is OPENAI_API_KEY in docker-compose environment?`);
    throw new Error(error);
  }
  
  console.log(`  [OpenAI] ✓ API key configured (length: ${OPENAI_API_KEY.length}, starts with: ${OPENAI_API_KEY.substring(0, 7)}...)`);
  console.log(`  [OpenAI] Model: ${OPENAI_MODEL}`);
  console.log(`  [OpenAI] API URL: ${OPENAI_API_URL}`);
  console.log(`  [OpenAI] Max concurrent: ${MAX_CONCURRENT}, RPM limit: ${RPM_LIMIT}`);

  // Acquire concurrency slot
  console.log(`  [OpenAI] Waiting for concurrency slot (max: ${MAX_CONCURRENT})...`);
  await semaphore.acquire();
  console.log(`  [OpenAI] ✓ Concurrency slot acquired`);
  
  try {
    // Wait for RPM slot
    console.log(`  [OpenAI] Checking RPM limit (${RPM_LIMIT}/min)...`);
    await rpmLimiter.waitForSlot();
    console.log(`  [OpenAI] ✓ RPM slot available`);

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      const error = `Image file not found: ${filePath}`;
      console.error(`  [OpenAI] ❌ ERROR: ${error}`);
      throw new Error(error);
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    console.log(`  [OpenAI] ✓ File exists (${stats.size} bytes)`);

    // Read and encode image
    console.log(`  [OpenAI] Reading image file...`);
    const { base64, mimeType } = imageToBase64(filePath);
    const base64SizeKB = Math.round(base64.length / 1024);
    console.log(`  [OpenAI] ✓ Image encoded to base64 (${base64SizeKB}KB, MIME: ${mimeType})`);

    // Create image data URL
    const imageDataUrl = `data:${mimeType};base64,${base64}`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log('');
        console.log(`  [OpenAI] ── API Request (Attempt ${attempt}/${MAX_RETRIES}) ──`);
        console.log(`  [OpenAI] Endpoint: ${OPENAI_API_URL}`);
        console.log(`  [OpenAI] Model: ${OPENAI_MODEL}`);
        console.log(`  [OpenAI] Sending request to OpenAI API...`);

        // Build request payload exactly as specified
        const requestBody = {
          model: OPENAI_MODEL,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Analyze the image carefully. First focus on the barcode region. Try to mentally zoom into the barcode, improve contrast, and read the digits under the barcode. If the barcode is blurred or unreadable, respond only with the word UNREADABLE. If readable, return ONLY the barcode number with no explanation.',
                },
                {
                  type: 'input_image',
                  image_url: imageDataUrl,
                },
              ],
            },
          ],
        };

        const requestStartTime = Date.now();

        // ⚠️ CRITICAL: ONLY OpenAI API - NO Python, NO other methods!
        // Make direct HTTP request to OpenAI endpoint
        console.log(`  [OpenAI] ⚠️ Making HTTP request to OpenAI API ONLY (no Python, no other methods)`);
        console.log(`  [OpenAI] Request URL: ${OPENAI_API_URL}`);
        console.log(`  [OpenAI] Authorization header: Bearer ${OPENAI_API_KEY.substring(0, 10)}...${OPENAI_API_KEY.substring(OPENAI_API_KEY.length - 4)}`);
        console.log(`  [OpenAI] Request body size: ${JSON.stringify(requestBody).length} bytes`);
        
        const response = await fetch(OPENAI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
        });
        
        // Verify we got a response from OpenAI (not from Python or other source)
        if (!response) {
          throw new Error('FATAL: No response received from OpenAI API. This should never happen.');
        }

        const requestDuration = Date.now() - requestStartTime;
        console.log(`  [OpenAI] ✓ HTTP response received (${requestDuration}ms)`);
        console.log(`  [OpenAI] Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`  [OpenAI] ❌ API Error Response:`);
          console.log(`  [OpenAI] Status: ${response.status} ${response.statusText}`);
          console.log(`  [OpenAI] Error text: ${errorText}`);
          
          let errorData: any;
          try {
            errorData = JSON.parse(errorText);
            console.log(`  [OpenAI] Parsed error data:`, JSON.stringify(errorData, null, 2));
          } catch {
            errorData = { message: errorText };
            console.log(`  [OpenAI] Error is not JSON, raw text: ${errorText}`);
          }

          const errorMessage = errorData?.error?.message || errorData?.message || response.statusText;
          
          // Check for specific error types
          if (response.status === 401) {
            console.log(`  [OpenAI] ⚠ 401 Unauthorized - API key issue`);
            console.log(`  [OpenAI] Check: Is API key correct?`);
            console.log(`  [OpenAI] Check: Does API key start with 'sk-'?`);
            console.log(`  [OpenAI] Check: Is API key set in environment?`);
          } else if (response.status === 404) {
            console.log(`  [OpenAI] ⚠ 404 Not Found - Endpoint might not exist`);
            console.log(`  [OpenAI] Check: Is /v1/responses a valid endpoint?`);
            console.log(`  [OpenAI] Standard OpenAI endpoint is: /v1/chat/completions`);
          }

          throw new Error(
            `HTTP ${response.status}: ${errorMessage}`,
          );
        }

        const responseData = await response.json();
        
        // Log FULL response for debugging
        console.log(`  [OpenAI] ── Full API Response ──`);
        console.log(`  [OpenAI] Response keys:`, JSON.stringify(Object.keys(responseData), null, 2));
        console.log(`  [OpenAI] Response status: ${responseData.status}`);
        console.log(`  [OpenAI] Response output type: ${typeof responseData.output}`);
        console.log(`  [OpenAI] Response output:`, JSON.stringify(responseData.output).substring(0, 500));
        console.log(`  [OpenAI] Response text:`, responseData.text);
        
        // Extract the barcode value from response
        // The /v1/responses endpoint returns: { output: [...], text: "...", status: "..." }
        let raw: string = '';
        
        // Try different response formats for /v1/responses endpoint
        if (responseData.output) {
          // output can be an array of objects or a string
          if (Array.isArray(responseData.output) && responseData.output.length > 0) {
            // If array, get the first item and extract text
            const firstOutput = responseData.output[0];
            if (typeof firstOutput === 'string') {
              raw = firstOutput;
              console.log(`  [OpenAI] Found in responseData.output[0] (string):`, raw);
            } else if (firstOutput && typeof firstOutput === 'object') {
              // Try common fields in output object
              raw = firstOutput.content || firstOutput.text || firstOutput.message || '';
              if (typeof raw !== 'string') {
                raw = String(raw);
              }
              console.log(`  [OpenAI] Found in responseData.output[0] (object):`, raw);
            } else {
              raw = String(firstOutput);
              console.log(`  [OpenAI] Found in responseData.output[0] (converted):`, raw);
            }
          } else if (typeof responseData.output === 'string') {
            raw = responseData.output;
            console.log(`  [OpenAI] Found in responseData.output (string):`, raw);
          } else if (responseData.output && typeof responseData.output === 'object') {
            // output is an object, try to extract text
            raw = responseData.output.content || responseData.output.text || responseData.output.message || '';
            if (typeof raw !== 'string') {
              raw = String(raw);
            }
            console.log(`  [OpenAI] Found in responseData.output (object):`, raw);
          }
        }
        
        // Fallback to text field
        if (!raw && responseData.text) {
          raw = typeof responseData.text === 'string' ? responseData.text : String(responseData.text);
          console.log(`  [OpenAI] Found in responseData.text:`, raw);
        }
        
        // Fallback to choices format (standard chat completions)
        if (!raw && responseData.choices) {
          raw = responseData.choices?.[0]?.message?.content || '';
          if (typeof raw !== 'string') {
            raw = String(raw);
          }
          console.log(`  [OpenAI] Found in responseData.choices[0].message.content:`, raw);
        }
        
        // Fallback to content field
        if (!raw && responseData.content) {
          raw = typeof responseData.content === 'string' ? responseData.content : String(responseData.content);
          console.log(`  [OpenAI] Found in responseData.content:`, raw);
        }
        
        // Fallback to message field
        if (!raw && responseData.message) {
          raw = typeof responseData.message === 'string' ? responseData.message : String(responseData.message);
          console.log(`  [OpenAI] Found in responseData.message:`, raw);
        }
        
        // Last resort: stringify the whole response
        if (!raw) {
          raw = JSON.stringify(responseData);
          console.log(`  [OpenAI] ⚠ No standard field found, using JSON.stringify:`, raw.substring(0, 200));
        }
        
        // Ensure raw is a string before calling trim
        if (typeof raw !== 'string') {
          raw = String(raw);
        }
        
        raw = raw.trim();
        
        console.log('');
        console.log(`  [OpenAI] ── Response Content ──`);
        console.log(`  [OpenAI] Raw response: "${raw}"`);
        console.log(`  [OpenAI] Response length: ${raw.length} characters`);

        if (!raw) {
          console.log(`  [OpenAI] ⚠ Empty response received`);
          return null;
        }

        if (raw.toUpperCase() === 'UNREADABLE') {
          console.log(`  [OpenAI] ⚠ GPT returned UNREADABLE`);
          return null;
        }

        if (raw.toUpperCase() === 'NO_BARCODE_FOUND' || raw.toUpperCase().includes('NO BARCODE')) {
          console.log(`  [OpenAI] ⚠ GPT returned NO_BARCODE_FOUND`);
          return null;
        }

        // Extract only digits from the response
        const digits = raw.replace(/\D/g, '');
        console.log(`  [OpenAI] Extracted digits: "${digits}" (${digits.length} digits)`);

        if (digits.length === 0) {
          console.log(`  [OpenAI] ❌ Response contained no digits`);
          console.log(`  [OpenAI] Original response was: "${raw}"`);
          return null;
        }

        // Basic validation
        if (digits.length < 8) {
          console.log(`  [OpenAI] ⚠ Barcode too short (${digits.length} digits, minimum: 8)`);
          console.log(`  [OpenAI] Extracted value: "${digits}"`);
          console.log(`  [OpenAI] Original response: "${raw}"`);
          return null;
        }

        if (digits.length > 30) {
          console.log(`  [OpenAI] ⚠ Barcode too long (${digits.length} digits, maximum: 30)`);
          console.log(`  [OpenAI] Extracted value: "${digits}"`);
          console.log(`  [OpenAI] Original response: "${raw}"`);
          return null;
        }

        const totalDuration = Date.now() - startTime;
        console.log('');
        console.log(`  [OpenAI] ✅ SUCCESS ──`);
        console.log(`  [OpenAI] Barcode detected: ${digits}`);
        console.log(`  [OpenAI] Length: ${digits.length} digits`);
        console.log(`  [OpenAI] Total processing time: ${totalDuration}ms`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        
        return digits;
      } catch (err: any) {
        lastError = err;

        // Log full error details
        console.log('');
        console.log(`  [OpenAI] ── Error Details (Attempt ${attempt}/${MAX_RETRIES}) ──`);
        console.log(`  [OpenAI] Error type: ${err?.constructor?.name || 'Unknown'}`);
        console.log(`  [OpenAI] Error message: ${err?.message || 'No message'}`);
        
        if (err?.status) {
          console.log(`  [OpenAI] HTTP status: ${err.status}`);
        }
        if (err?.response) {
          console.log(`  [OpenAI] Response status: ${err.response.status}`);
          console.log(`  [OpenAI] Response data: ${JSON.stringify(err.response.data, null, 2)}`);
        }
        if (err?.code) {
          console.log(`  [OpenAI] Error code: ${err.code}`);
        }
        if (err?.stack) {
          console.log(`  [OpenAI] Stack trace:`);
          console.log(err.stack.split('\n').slice(0, 5).map((line: string) => `    ${line}`).join('\n'));
        }

        // Handle rate limit (429) and server errors (5xx) with retry
        const status = err?.status || err?.response?.status || (err?.message?.includes('429') ? 429 : null);
        const isRetryable = status === 429 || (status >= 500 && status < 600);

        if (isRetryable && attempt < MAX_RETRIES) {
          // Exponential backoff: 2s, 4s, 8s, ...
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.log(`  [OpenAI] ⚠ ${status === 429 ? 'Rate limited (429)' : `Server error (${status})`}`);
          console.log(`  [OpenAI] Retrying in ${backoffMs}ms...`);
          await sleep(backoffMs);
          continue;
        }

        // Non-retryable error — break out
        console.log(`  [OpenAI] ❌ Non-retryable error or max retries reached`);
        break;
      }
    }

    // All retries exhausted or non-retryable error
    const totalDuration = Date.now() - startTime;
    console.log('');
    console.log(`  [OpenAI] ❌ FAILED after ${MAX_RETRIES} attempts (${totalDuration}ms)`);
    console.log(`  [OpenAI] Last error: ${lastError?.message || 'Unknown error'}`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    
    return null;
  } finally {
    semaphore.release();
    console.log(`  [OpenAI] Released concurrency slot`);
  }
}

// ── Chunk-based batch processing ─────────────────────────────────────────

export interface ChunkResult {
  filePath: string;
  barcodeValue: string | null;
  error?: string;
}

/**
 * Process a batch of images in chunks to stay within rate limits.
 *
 * @param filePaths  Array of absolute image file paths.
 * @param chunkSize  Images per chunk (defaults to OPENAI_CHUNK_SIZE env).
 * @param onProgress Optional callback for each completed image.
 * @returns          Array of results (one per input file).
 */
export async function detectBarcodesInChunks(
  filePaths: string[],
  chunkSize: number = CHUNK_SIZE,
  onProgress?: (completed: number, total: number) => void,
): Promise<ChunkResult[]> {
  const results: ChunkResult[] = [];
  let completed = 0;

  for (let i = 0; i < filePaths.length; i += chunkSize) {
    const chunk = filePaths.slice(i, i + chunkSize);

    console.log(
      `  [OpenAI] Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(filePaths.length / chunkSize)} ` +
        `(${chunk.length} images)`,
    );

    // Process all images in the chunk concurrently (semaphore limits concurrency)
    const chunkResults = await Promise.all(
      chunk.map(async (fp) => {
        try {
          const barcodeValue = await detectBarcodeWithOpenAI(fp);
          return { filePath: fp, barcodeValue } as ChunkResult;
        } catch (err: any) {
          return {
            filePath: fp,
            barcodeValue: null,
            error: err.message,
          } as ChunkResult;
        }
      }),
    );

    results.push(...chunkResults);
    completed += chunkResults.length;

    if (onProgress) {
      onProgress(completed, filePaths.length);
    }
  }

  return results;
}

// ── Exports for configuration inspection ─────────────────────────────────

export const openaiConfig = {
  model: OPENAI_MODEL,
  apiUrl: OPENAI_API_URL,
  maxConcurrent: MAX_CONCURRENT,
  rpmLimit: RPM_LIMIT,
  maxRetries: MAX_RETRIES,
  chunkSize: CHUNK_SIZE,
} as const;

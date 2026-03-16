# OpenAI API Logging Guide

## 🔍 What Logs to Look For

After rebuilding your Docker containers, you should see detailed logs showing exactly what's happening with the OpenAI API.

### ✅ **Correct Logs (Using OpenAI)**

When the worker is correctly using OpenAI, you'll see:

```
═══════════════════════════════════════════════════════════
  [Processor] Starting image processing
  [Processor] Original filename: IMG-20260312-WA0004.jpg
  [Processor] File path: /app/storage/original/xxx.jpg
  [Processor] Extension: .jpg
  [Processor] Using: OpenAI Vision API (NOT Python)
═══════════════════════════════════════════════════════════
  [Processor] ✓ File exists (279376 bytes)
  [Processor] Calling detectBarcodeWithOpenAI()...

═══════════════════════════════════════════════════════════
  [OpenAI] Starting barcode detection
  File: xxx.jpg
  Path: /app/storage/original/xxx.jpg
═══════════════════════════════════════════════════════════
  [OpenAI] ✓ API key configured (length: 51, starts with: sk-proj...)
  [OpenAI] Model: gpt-4o-mini
  [OpenAI] Max concurrent: 5, RPM limit: 50
  [OpenAI] Waiting for concurrency slot (max: 5)...
  [OpenAI] ✓ Concurrency slot acquired
  [OpenAI] Checking RPM limit (50/min)...
  [OpenAI] ✓ RPM slot available
  [OpenAI] ✓ File exists (279376 bytes)
  [OpenAI] Reading image file...
  [OpenAI] ✓ Image encoded to base64 (372KB, MIME: image/jpeg)

  [OpenAI] ── API Request (Attempt 1/3) ──
  [OpenAI] Model: gpt-4o-mini
  [OpenAI] Max tokens: 100
  [OpenAI] Temperature: 0
  [OpenAI] Image detail: high
  [OpenAI] Sending request to OpenAI API...
  [OpenAI] ✓ API response received (1234ms)
  [OpenAI] Response ID: chatcmpl-xxx
  [OpenAI] Model used: gpt-4o-mini
  [OpenAI] Token usage:
    - Prompt tokens: 1234
    - Completion tokens: 15
    - Total tokens: 1249

  [OpenAI] ── Response Content ──
  [OpenAI] Raw response: "8901234567890"
  [OpenAI] Response length: 13 characters
  [OpenAI] Extracted digits: "8901234567890" (13 digits)

  [OpenAI] ✅ SUCCESS ──
  [OpenAI] Barcode detected: 8901234567890
  [OpenAI] Length: 13 digits
  [OpenAI] Total processing time: 2345ms
═══════════════════════════════════════════════════════════
```

### ❌ **Wrong Logs (Still Using Python)**

If you see these logs, the container is still running old code:

```
[Processor] Python error: Command failed: python3 /app/scripts/detect_barcode.py
Processing file: /app/storage/original/xxx.jpg
```

**Solution:** Rebuild containers:
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### 🔍 **Error Logs**

#### Missing API Key
```
[OpenAI] ❌ ERROR: OPENAI_API_KEY environment variable is not set
```

**Solution:** Set `OPENAI_API_KEY` in `.env` or docker-compose environment

#### API Error (429 Rate Limit)
```
[OpenAI] ── Error Details (Attempt 1/3) ──
[OpenAI] HTTP status: 429
[OpenAI] ⚠ Rate limited (429)
[OpenAI] Retrying in 2000ms...
```

**Solution:** Reduce `OPENAI_RPM_LIMIT` or `OPENAI_MAX_CONCURRENT` in `.env`

#### API Error (401 Unauthorized)
```
[OpenAI] ── Error Details ──
[OpenAI] HTTP status: 401
[OpenAI] Error message: Incorrect API key provided
```

**Solution:** Check your `OPENAI_API_KEY` is correct

#### API Error (Network/Timeout)
```
[OpenAI] ── Error Details ──
[OpenAI] Error code: ECONNREFUSED
[OpenAI] Error message: connect ECONNREFUSED
```

**Solution:** Check network connectivity to OpenAI API

### 📊 **What Each Log Section Means**

1. **Processor logs** — Shows file processing started, which method is used
2. **OpenAI initialization** — API key check, model config, rate limits
3. **Concurrency/RPM** — Shows rate limiting in action
4. **API request** — Shows what's being sent to OpenAI
5. **API response** — Shows full response including tokens used
6. **Response parsing** — Shows how the response is processed
7. **Final result** — Success or failure with barcode value

### 🎯 **Key Indicators**

✅ **Good signs:**
- `[Processor] Using: OpenAI Vision API (NOT Python)`
- `[OpenAI] ✓ API key configured`
- `[OpenAI] ✓ API response received`
- `[OpenAI] ✅ SUCCESS`

❌ **Bad signs:**
- `[Processor] Python error`
- `[OpenAI] ❌ ERROR`
- `Command failed: python3`
- Any mention of `detect_barcode.py`

### 🐛 **Debugging Tips**

1. **Check worker logs:**
   ```bash
   docker logs barocode-worker -f
   ```

2. **Check if API key is set:**
   ```bash
   docker exec barocode-worker env | grep OPENAI_API_KEY
   ```

3. **Verify code is rebuilt:**
   ```bash
   docker exec barocode-worker ls -la /app/dist/modules/queue/
   # Should see image.processor.js (not Python script)
   ```

4. **Check what function is being called:**
   Look for `[Processor] Using: OpenAI Vision API` — if you don't see this, it's old code.


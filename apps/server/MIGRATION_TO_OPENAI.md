# Migration to OpenAI Vision API

## ✅ What Changed

1. **Removed Python barcode detection** — The entire `detect_barcode.py` script (940 lines) has been deleted
2. **Replaced with OpenAI Vision API** — All barcode reading now uses GPT-4o-mini Vision API
3. **Added rate limiting** — Built-in semaphore + RPM limiter prevents hitting OpenAI rate limits
4. **Improved prompts** — Detailed instructions for GPT to decode barcode bars (not printed text)

## 🔧 To Deploy

### 1. Set OpenAI API Key

Create a `.env` file in the project root (or set environment variables):

```bash
OPENAI_API_KEY=sk-your-actual-api-key-here
```

### 2. Rebuild Docker Containers

The old containers have compiled Python code. You MUST rebuild:

```bash
# Stop existing containers
docker-compose down

# Rebuild with new code (no Python dependencies)
docker-compose build --no-cache

# Start fresh
docker-compose up -d
```

### 3. Verify Worker is Using OpenAI

Check worker logs:

```bash
docker logs barocode-worker
```

You should see:
```
🔧 Barocode Image Processing Worker (OpenAI Vision)
🤖 Model: gpt-4o-mini
🔒 OpenAI concurrency: 5
📊 OpenAI RPM limit: 50
```

**NOT** Python errors like:
```
[Processor] Python error: Command failed: python3 /app/scripts/detect_barcode.py
```

## 📝 Environment Variables

All configurable via `.env` or docker-compose:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | **required** | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o-mini` | Vision model to use |
| `OPENAI_MAX_CONCURRENT` | `5` | Max parallel API requests |
| `OPENAI_RPM_LIMIT` | `50` | Requests per minute cap |
| `OPENAI_MAX_RETRIES` | `3` | Retries on 429/5xx errors |
| `OPENAI_CHUNK_SIZE` | `10` | Images per batch chunk |
| `MAX_WORKER_CONCURRENCY` | `10` | BullMQ worker concurrency |

## 🎯 How It Works

1. **Image uploaded** → Saved to `storage/original/`
2. **Job queued** → BullMQ adds job to Redis queue
3. **Worker picks up job** → Calls `detectBarcodeWithOpenAI()`
4. **Rate limiting** → Semaphore + RPM limiter ensure we don't exceed limits
5. **OpenAI Vision API** → Sends image with detailed barcode-reading prompt
6. **GPT decodes barcode** → Returns numeric digits from bar pattern
7. **File renamed** → Moved to `storage/processed/{barcode}.jpg`

## 🔍 Improved Prompt

The OpenAI prompt now explicitly instructs GPT to:
- Look for vertical black bars (barcode pattern)
- Decode the BAR PATTERN itself (not printed text below)
- Scan entire image (barcode may be anywhere)
- Return only digits, no formatting
- Handle rotated/partial barcodes

## ⚠️ Troubleshooting

**Problem:** Still seeing Python errors
**Solution:** Old Docker containers are running. Rebuild:
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

**Problem:** `OPENAI_API_KEY environment variable is required`
**Solution:** Set the API key in `.env` or docker-compose environment

**Problem:** Rate limit errors (429)
**Solution:** Reduce `OPENAI_MAX_CONCURRENT` or `OPENAI_RPM_LIMIT` in `.env`

**Problem:** No barcode detected
**Solution:** Check worker logs for OpenAI responses. The prompt may need further tuning for your specific barcode types.


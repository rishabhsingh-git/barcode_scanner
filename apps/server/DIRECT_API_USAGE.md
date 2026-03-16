# ✅ Direct OpenAI /v1/responses API Integration

## What Changed

1. **Removed OpenAI SDK** - No longer using `openai` npm package
2. **Direct HTTP calls** - Using native `fetch()` to call `https://api.openai.com/v1/responses`
3. **Exact format** - Using the exact request format you specified:
   ```json
   {
     "model": "gpt-4.1",
     "input": [
       {
         "role": "user",
         "content": [
           {
             "type": "input_text",
             "text": "Analyze the image carefully..."
           },
           {
             "type": "input_image",
             "image_url": "data:image/jpeg;base64,..."
           }
         ]
       }
     ]
   }
   ```

## API Endpoint

- **URL**: `https://api.openai.com/v1/responses`
- **Method**: `POST`
- **Headers**: 
  - `Content-Type: application/json`
  - `Authorization: Bearer {OPENAI_API_KEY}`

## Request Format

The code now sends requests exactly as you specified:
- Model: `gpt-4.1` (configurable via `OPENAI_MODEL` env var)
- Input format: Array with `role: 'user'` and `content` array
- Content types: `input_text` and `input_image`
- Image format: Base64 data URL (`data:image/jpeg;base64,...`)

## Response Handling

The code handles multiple response formats:
- `responseData.output` (array or string)
- `responseData.choices[0].message.content` (chat format)
- `responseData.text`
- Direct string response

## Configuration

Environment variables:
- `OPENAI_API_KEY` - Required
- `OPENAI_MODEL` - Default: `gpt-4.1`
- `OPENAI_MAX_CONCURRENT` - Default: 5
- `OPENAI_RPM_LIMIT` - Default: 50
- `OPENAI_MAX_RETRIES` - Default: 3

## To Use

1. **Set API key:**
   ```bash
   export OPENAI_API_KEY=sk-your-key-here
   ```

2. **Rebuild (if needed):**
   ```bash
   cd apps/server
   npm run build
   ```

3. **Restart worker:**
   ```bash
   npm run worker
   ```

   Or in Docker:
   ```bash
   docker-compose down
   docker-compose build --no-cache
   docker-compose up -d
   ```

## What You'll See

Logs will show:
```
[OpenAI] API URL: https://api.openai.com/v1/responses
[OpenAI] Endpoint: https://api.openai.com/v1/responses
[OpenAI] Sending request to OpenAI API...
[OpenAI] ✓ HTTP response received (1234ms)
[OpenAI] Status: 200 OK
```

## Notes

- Uses native `fetch()` (Node.js 18+)
- No external SDK dependencies for API calls
- All rate limiting and error handling preserved
- Detailed logging for debugging


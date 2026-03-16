# 🔑 Fix: Incorrect API Key Error

## The Issue

You're getting "incorrect API key" error for `https://api.openai.com/v1/responses`.

## Important Discovery

**`/v1/responses` is NOT a standard OpenAI endpoint!**

The standard OpenAI Vision API uses:
- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Different request format**

## Possible Causes

1. **Wrong Endpoint**: `/v1/responses` might not exist or might be a custom API
2. **API Key Format**: The key might not be sent correctly
3. **Request Format**: The request body format might be wrong for this endpoint

## What to Check

### 1. Check the Exact Error

After rebuilding, check logs for:
```bash
docker logs barocode-worker -f
```

Look for:
```
[OpenAI] ❌ API Error Response:
[OpenAI] Status: 401 Unauthorized
[OpenAI] Error text: {...}
```

This will show the **exact error message** from the API.

### 2. Verify API Key

Check if the API key is being sent correctly:
```
[OpenAI] Authorization header: Bearer sk-proj...xxxx
```

### 3. Test in Postman

If `/v1/responses` works in Postman, compare:
- **Headers** - Are they exactly the same?
- **Request body** - Is the format identical?
- **API key** - Is it the same key?

## Solution Options

### Option 1: Use Standard OpenAI Endpoint

If `/v1/responses` doesn't work, we can switch to the standard `/v1/chat/completions` endpoint:

```typescript
// Standard OpenAI Vision API format
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Analyze the image..."
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,..."
          }
        }
      ]
    }
  ]
}
```

### Option 2: Fix Current Endpoint

If `/v1/responses` is correct (works in Postman), we need to:
1. See the exact error message
2. Compare request format with Postman
3. Fix any differences

## Next Steps

1. **Rebuild and restart**:
   ```bash
   docker-compose restart worker
   ```

2. **Check logs** for the exact error:
   ```bash
   docker logs barocode-worker -f
   ```

3. **Share the error details**:
   - Status code (401, 404, etc.)
   - Error message from API
   - Request headers being sent

4. **Based on the error**, I'll either:
   - Fix the request format for `/v1/responses`
   - Switch to standard `/v1/chat/completions` endpoint

## Quick Test

To verify your API key works, test with standard endpoint:

```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

If this works, your API key is valid. Then we need to fix the endpoint/format.


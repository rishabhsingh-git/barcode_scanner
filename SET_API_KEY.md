# 🔑 How to Set OPENAI_API_KEY

## The Problem

The worker container can't find `OPENAI_API_KEY` environment variable.

## ✅ Solution: Create .env File

### Step 1: Create `.env` file in project root

Create a file named `.env` in `d:\barocode_master\` (same folder as `docker-compose.yml`):

```bash
# In project root (d:\barocode_master\.env)
OPENAI_API_KEY=sk-your-actual-api-key-here
OPENAI_MODEL=gpt-4.1
OPENAI_MAX_CONCURRENT=5
OPENAI_RPM_LIMIT=50
```

### Step 2: Restart Docker Containers

After creating `.env`, restart containers to load the new environment variables:

```bash
docker-compose down
docker-compose up -d
```

Or restart just the worker:

```bash
docker-compose restart worker
```

### Step 3: Verify It's Set

Check if the environment variable is loaded:

```bash
docker exec barocode-worker env | grep OPENAI_API_KEY
```

You should see:
```
OPENAI_API_KEY=sk-...
```

## Alternative: Set Environment Variable Directly

If you don't want to use `.env` file, set it before running docker-compose:

### Windows PowerShell:
```powershell
$env:OPENAI_API_KEY="sk-your-key-here"
docker-compose up -d
```

### Windows CMD:
```cmd
set OPENAI_API_KEY=sk-your-key-here
docker-compose up -d
```

### Linux/Mac:
```bash
export OPENAI_API_KEY=sk-your-key-here
docker-compose up -d
```

## Quick Fix Command

```bash
# 1. Create .env file (edit with your actual key)
echo OPENAI_API_KEY=sk-your-key-here > .env

# 2. Restart containers
docker-compose restart worker

# 3. Check logs
docker logs barocode-worker -f
```

## Verify It's Working

After restarting, check worker logs:

```bash
docker logs barocode-worker -f
```

You should see:
```
[OpenAI] ✓ API key configured (length: 51, starts with: sk-proj...)
[OpenAI] API URL: https://api.openai.com/v1/responses
```

**NOT:**
```
[OpenAI] ❌ ERROR: OPENAI_API_KEY environment variable is not set
```

## Important Notes

1. **`.env` file location**: Must be in the **project root** (same folder as `docker-compose.yml`)
2. **No quotes needed**: Just `OPENAI_API_KEY=sk-...` (no quotes around the value)
3. **Restart required**: Containers need to be restarted to pick up new environment variables
4. **Security**: Never commit `.env` file to git (it should be in `.gitignore`)


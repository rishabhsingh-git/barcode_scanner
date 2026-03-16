# ✅ Dynamsoft Barcode Reader Integration

## What Was Integrated

1. **Dynamsoft Barcode Reader SDK** - Installed `dynamsoft-barcode-reader-bundle@^11.2.4000`
2. **Sharp** - Installed for image cropping (`sharp@^0.33.4`)
3. **Top 30% Cropping** - Automatically crops image to top 30% before scanning
4. **License Key** - Integrated your license key: `DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA1Mjk2MjQ3LU1UQTFNamsyTWpRM0xYZGxZaTFVY21saGJGQnliMm8iLCJtYWluU2VydmVyVVJMIjoiaHR0cHM6Ly9tZGxzLmR5bmFtc29mdG9ubGluZS5jb20vIiwib3JnYW5pemF0aW9uSUQiOiIxMDUyOTYyNDciLCJzdGFuZGJ5U2VydmVyVVJMIjoiaHR0cHM6Ly9zZGxzLmR5bmFtc29mdG9ubGluZS5jb20vIiwiY2hlY2tDb2RlIjotMTMzODkyNzQyMn0=`

## How It Works

1. **Image Upload** → Saved to `storage/original/`
2. **Crop to Top 30%** → Uses Sharp to extract top portion (where barcodes usually are)
3. **Dynamsoft Scan** → SDK scans the cropped region for barcodes
4. **Extract Digits** → Validates and extracts barcode number
5. **Rename File** → Moves to `storage/processed/{barcode}.jpg`

## Files Created/Modified

### Created:
- `src/common/dynamsoft-client.ts` - Dynamsoft SDK integration with top 30% cropping

### Modified:
- `src/modules/queue/image.processor.ts` - Now uses Dynamsoft instead of OpenAI
- `package.json` - Added `dynamsoft-barcode-reader-bundle` and `sharp`
- `Dockerfile` - Added system libraries for Dynamsoft SDK

### Kept Aside (Not Deleted):
- `src/common/openai-client.ts` - OpenAI code kept for future use
- All OpenAI-related code is commented out but available

## License Initialization

The SDK uses the Foundational API as per Dynamsoft documentation:
```typescript
LicenseManager.initLicense("YOUR_LICENSE_KEY")
```

Reference: https://www.dynamsoft.com/barcode-reader/docs/core/license-activation/index.html#set-the-license-in-the-code

## To Deploy

### 1. Rebuild Docker Containers

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### 2. Verify It's Working

Check worker logs:
```bash
docker logs barocode-worker -f
```

You should see:
```
[Dynamsoft] Starting barcode detection
[Dynamsoft] Cropping to top 30%: 1135x480
[Dynamsoft] ✓ License initialized successfully
[Dynamsoft] Scanning barcode from cropped image...
[Dynamsoft] ✅ SUCCESS ──
[Dynamsoft] Barcode detected: 1234567890123
```

## Features

- ✅ **Top 30% Scanning** - Only scans top portion for faster processing
- ✅ **Automatic Cropping** - Uses Sharp to crop before scanning
- ✅ **License Integrated** - Your license key is hardcoded
- ✅ **Error Handling** - Falls back to full image if cropping fails
- ✅ **Cleanup** - Automatically removes temporary cropped images
- ✅ **Validation** - Validates barcode length (8-30 digits)

## Configuration

The license key is hardcoded in `src/common/dynamsoft-client.ts`:
```typescript
const DYNAMSOFT_LICENSE_KEY = 'DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA1Mjk2MjQ3LU1UQTFNamsyTWpRM0xYZGxZaTFVY21saGJGQnliMm8iLCJtYWluU2VydmVyVVJMIjoiaHR0cHM6Ly9tZGxzLmR5bmFtc29mdG9ubGluZS5jb20vIiwib3JnYW5pemF0aW9uSUQiOiIxMDUyOTYyNDciLCJzdGFuZGJ5U2VydmVyVVJMIjoiaHR0cHM6Ly9zZGxzLmR5bmFtc29mdG9ubGluZS5jb20vIiwiY2hlY2tDb2RlIjotMTMzODkyNzQyMn0=';
```

To change it, edit the file and rebuild.

## Notes

- OpenAI code is kept aside (commented out) but not deleted
- Dynamsoft SDK is now the primary barcode detection method
- Top 30% cropping improves speed and focuses on barcode region
- Temporary cropped images are automatically cleaned up


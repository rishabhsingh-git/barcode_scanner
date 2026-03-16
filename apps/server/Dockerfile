FROM node:20-slim

WORKDIR /app

# Install system dependencies for Dynamsoft Python SDK and Sharp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    libgl1 \
    libglib2.0-0 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Node.js dependencies (cached layer)
COPY package.json package-lock.json ./
RUN npm ci

# Install Python dependencies for Dynamsoft and image preprocessing
# Note: Dynamsoft Python SDK package name is 'dbr'
RUN pip3 install --break-system-packages --no-cache-dir dbr Pillow opencv-python numpy pytesseract

# Install Tesseract OCR engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy source code and build
COPY . .
RUN npm run build

# Verify build output exists
RUN ls -la /app/dist/ || echo "dist folder not found"
RUN ls -la /app/dist/src/workers/ || echo "workers folder not found"
RUN test -f /app/dist/src/workers/image.worker.js || (echo "ERROR: image.worker.js not found!" && exit 1)

# Ensure Python scripts are executable
RUN chmod +x /app/scripts/detect_barcode.py /app/scripts/preprocess_image.py || true

EXPOSE 3001

# Default command runs the API server
# NestJS builds to dist/src/main.js
# To run the worker: docker run ... node dist/src/workers/image.worker.js
CMD ["node", "dist/src/main"]

#!/usr/bin/env python3
"""
Image Preprocessing Service for Barcode Detection
Improves detection of blurred, low-contrast, or damaged barcodes.

Pipeline:
1. Convert to grayscale
2. Increase contrast
3. Sharpen
4. Adaptive threshold
5. Return processed image path
"""

import sys
import os
import cv2
import numpy as np

def preprocess_image(input_path, output_path=None):
    """
    Preprocess image to improve barcode detection.
    
    Args:
        input_path: Path to input image
        output_path: Path to save processed image (optional, auto-generated if None)
    
    Returns:
        Path to processed image
    """
    if not os.path.exists(input_path):
        print(f"ERROR: Image not found: {input_path}", file=sys.stderr)
        return None
    
    # Generate output path if not provided
    if output_path is None:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_processed{ext}"
    
    try:
        # 1. Read image
        img = cv2.imread(input_path)
        if img is None:
            print(f"ERROR: Could not read image: {input_path}", file=sys.stderr)
            return None
        
        # 2. Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # 3. Increase contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        contrast = clahe.apply(gray)
        
        # 4. Sharpen using kernel
        sharpen_kernel = np.array([
            [0, -1, 0],
            [-1, 5, -1],
            [0, -1, 0]
        ], dtype=np.float32)
        sharpen = cv2.filter2D(contrast, -1, sharpen_kernel)
        
        # 5. Apply adaptive threshold
        thresh = cv2.adaptiveThreshold(
            sharpen,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            11,
            2
        )
        
        # 6. Save processed image
        cv2.imwrite(output_path, thresh)
        
        return output_path
        
    except Exception as e:
        print(f"ERROR: Preprocessing failed: {e}", file=sys.stderr)
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python preprocess_image.py <input_image> [output_image]", file=sys.stderr)
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    result = preprocess_image(input_path, output_path)
    
    if result:
        print(result)
        sys.exit(0)
    else:
        sys.exit(1)


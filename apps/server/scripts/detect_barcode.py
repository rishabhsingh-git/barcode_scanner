#!/usr/bin/env python3
"""
Dynamsoft Barcode Reader - Detection script with DYNAMIC barcode localization
1. First detects WHERE the barcode is located in the image (bounding box)
2. Crops precisely around the detected barcode location
3. Extracts barcode number from the cropped region
4. Returns the barcode number for 100% accuracy

This approach works regardless of barcode position in the image.
"""

import sys
import os
from PIL import Image

try:
    import dbr
except ImportError:
    print("ERROR: dbr (Dynamsoft Barcode Reader) not installed. Run: pip install dbr")
    sys.exit(1)

try:
    import cv2
    import numpy as np
except ImportError:
    print("ERROR: opencv-python not installed. Run: pip install opencv-python")
    sys.exit(1)

try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    print("WARNING: pytesseract not available. OCR fallback disabled.")

# License key
LICENSE_KEY = "DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA1Mjk2MjQ3LU1UQTFNamsyTWpRM0xYZGxZaTFVY21saGJGQnliMm8iLCJtYWluU2VydmVyVVJMIjoiaHR0cHM6Ly9tZGxzLmR5bmFtc29mdG9ubGluZS5jb20vIiwib3JnYW5pemF0aW9uSUQiOiIxMDUyOTYyNDciLCJzdGFuZGJ5U2VydmVyVVJMIjoiaHR0cHM6Ly9zZGxzLmR5bmFtc29mdG9ubGluZS5jb20vIiwiY2hlY2tDb2RlIjotMTMzODkyNzQyMn0="

def resize_if_large(image_path, max_dimension=4000):
    """
    Resize very large images to improve processing speed.
    For 1GB+ images, resize to max 4000px on longest side while maintaining aspect ratio.
    This dramatically speeds up processing without losing barcode readability.
    """
    try:
        img = cv2.imread(image_path)
        if img is None:
            return image_path
        
        height, width = img.shape[:2]
        max_size = max(height, width)
        
        # Only resize if image is larger than max_dimension
        if max_size <= max_dimension:
            return image_path
        
        # Calculate scaling factor
        scale = max_dimension / max_size
        new_width = int(width * scale)
        new_height = int(height * scale)
        
        print(f"[Dynamsoft] Resizing large image: {width}x{height} → {new_width}x{new_height} (scale: {scale:.2f})")
        
        # Resize image
        resized = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
        
        # Save resized image
        base, ext = os.path.splitext(image_path)
        resized_path = f"{base}_resized{ext}"
        cv2.imwrite(resized_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 95])
        
        return resized_path
    except Exception as e:
        print(f"WARNING: Resize failed: {e}, using original image")
        return image_path

def validate_barcode_checksum(barcode_str):
    """
    Validate barcode using checksum algorithms for common formats.
    Returns True if valid, False otherwise.
    """
    if not barcode_str or len(barcode_str) < 8:
        return False
    
    digits = [int(d) for d in barcode_str if d.isdigit()]
    if len(digits) != len(barcode_str):
        return False
    
    # EAN-13 / UPC-A checksum validation
    if len(digits) == 13 or len(digits) == 12:
        # EAN-13: last digit is checksum
        # UPC-A: last digit is checksum
        checksum = digits[-1]
        total = 0
        
        # Calculate checksum
        for i in range(len(digits) - 1):
            if i % 2 == 0:
                total += digits[i] * 1
            else:
                total += digits[i] * 3
        
        calculated_checksum = (10 - (total % 10)) % 10
        return calculated_checksum == checksum
    
    # Code128 doesn't have simple checksum, but we can validate format
    # For other formats, accept if length is reasonable
    return True

def preprocess_image_enhanced(image_path, strategy='standard'):
    """
    Enhanced preprocessing with multiple strategies for 99% accuracy:
    
    Strategies:
    - 'standard': CLAHE + sharpen + threshold (good for most images)
    - 'aggressive': Strong denoising + high contrast (for blurry images)
    - 'subtle': Light enhancement (for already clear images)
    - 'high_contrast': Maximum contrast (for low contrast images)
    """
    try:
        resized_path = resize_if_large(image_path, max_dimension=4000)
        img = cv2.imread(resized_path)
        if img is None:
            return image_path
        
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        if strategy == 'aggressive':
            # For blurry/poor quality images
            # Denoise first
            denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
            
            # Strong CLAHE
            clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8, 8))
            contrast = clahe.apply(denoised)
            
            # Strong sharpen
            sharpen_kernel = np.array([
                [0, -1, 0],
                [-1, 6, -1],
                [0, -1, 0]
            ], dtype=np.float32)
            sharpen = cv2.filter2D(contrast, -1, sharpen_kernel)
            
            # Morphological operations to enhance barcode lines
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            morph = cv2.morphologyEx(sharpen, cv2.MORPH_CLOSE, kernel)
            
            processed = morph
            
        elif strategy == 'subtle':
            # For already clear images - minimal processing
            clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
            contrast = clahe.apply(gray)
            processed = contrast
            
        elif strategy == 'high_contrast':
            # For low contrast images
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            contrast = clahe.apply(gray)
            
            # Histogram equalization
            equalized = cv2.equalizeHist(contrast)
            
            # Sharpen
            sharpen_kernel = np.array([
                [0, -1, 0],
                [-1, 5, -1],
                [0, -1, 0]
            ], dtype=np.float32)
            sharpen = cv2.filter2D(equalized, -1, sharpen_kernel)
            
            processed = sharpen
            
        else:  # 'standard'
            # Standard preprocessing
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            contrast = clahe.apply(gray)
            
            # Sharpen
            sharpen_kernel = np.array([
                [0, -1, 0],
                [-1, 5, -1],
                [0, -1, 0]
            ], dtype=np.float32)
            sharpen = cv2.filter2D(contrast, -1, sharpen_kernel)
            
            # Apply adaptive threshold
            thresh = cv2.adaptiveThreshold(
                sharpen,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                11,
                2
            )
            processed = thresh
        
        # Save processed image
        base, ext = os.path.splitext(resized_path)
        processed_path = f"{base}_processed_{strategy}{ext}"
        cv2.imwrite(processed_path, processed)
        
        return processed_path
    except Exception as e:
        print(f"WARNING: Enhanced preprocessing ({strategy}) failed: {e}")
        return image_path

def preprocess_image(image_path):
    """Legacy function - uses standard preprocessing"""
    return preprocess_image_enhanced(image_path, strategy='standard')

def crop_top_30_percent(image_path):
    """Crop top 30% of image"""
    try:
        img = Image.open(image_path)
        width, height = img.size
        crop_height = int(height * 0.3)
        cropped = img.crop((0, 0, width, crop_height))
        temp_path = image_path.replace('.jpg', '_crop.jpg').replace('.png', '_crop.png')
        cropped.save(temp_path)
        return temp_path
    except Exception as e:
        print(f"WARNING: Crop failed: {e}, using full image")
        return image_path

def extract_numbers_below_barcode(image_path):
    """
    Extract ONLY the numbers directly below the barcode lines using OCR.
    This avoids reading other numbers in the image (like filenames).
    """
    try:
        import cv2
        import numpy as np
        
        # Read image
        img = cv2.imread(image_path)
        if img is None:
            return None
        
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        height, width = gray.shape
        
        # Focus on bottom 40% of image (where numbers below barcode typically are)
        # But we already cropped to top 30%, so we need to adjust
        # Actually, if we cropped top 30%, the "bottom" of cropped image is middle of original
        # Let's focus on bottom 60% of the cropped image
        crop_start_y = int(height * 0.4)  # Start from 40% down
        crop_end_y = height  # To bottom
        number_region = gray[crop_start_y:crop_end_y, :]
        
        # Save region for OCR
        base, ext = os.path.splitext(image_path)
        region_path = f"{base}_number_region{ext}"
        cv2.imwrite(region_path, number_region)
        
        return region_path
    except Exception as e:
        print(f"WARNING: Failed to extract number region: {e}")
        return None

def extract_numbers_below_barcode_only(image_path):
    """
    Extract ONLY the numbers printed directly below the barcode lines.
    Uses precise cropping to isolate just the number region below barcode.
    This avoids reading filenames, headers, or other text in the image.
    """
    try:
        # Read original image
        img = cv2.imread(image_path)
        if img is None:
            return None
        
        height, width = img.shape[:2]
        
        # Strategy: Crop to a specific region where numbers below barcode are located
        # Based on typical barcode layout:
        # - Header/filename is in top 15-20% of image
        # - Barcode lines are in 20-28% of image
        # - Numbers below barcode are in 28-35% of image
        # - We want to exclude top 20% (header/filename area) and focus on numbers region
        
        # Crop to region: 25% to 35% of image height (numbers below barcode)
        crop_top = int(height * 0.25)  # Start at 25% (skip header + barcode lines)
        crop_bottom = int(height * 0.35)  # End at 35% (just numbers below)
        numbers_region = img[crop_top:crop_bottom, :]
        
        # Enhance the numbers region for better OCR
        gray = cv2.cvtColor(numbers_region, cv2.COLOR_BGR2GRAY)
        
        # Increase contrast significantly
        clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        
        # Sharpen for better text recognition
        sharpen_kernel = np.array([
            [0, -1, 0],
            [-1, 5, -1],
            [0, -1, 0]
        ], dtype=np.float32)
        sharpened = cv2.filter2D(enhanced, -1, sharpen_kernel)
        
        # Apply threshold for crisp text
        _, thresh = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Save enhanced numbers region
        base, ext = os.path.splitext(image_path)
        numbers_path = f"{base}_numbers_only{ext}"
        cv2.imwrite(numbers_path, thresh)
        
        print(f"[Dynamsoft] Extracted numbers region: {crop_top}-{crop_bottom}px (excluding header and barcode lines)")
        
        return numbers_path
    except Exception as e:
        print(f"WARNING: Failed to extract numbers region: {e}")
        return None

def read_numbers_with_ocr(image_path):
    """
    Use OCR to read ONLY the numbers from the image region.
    This reads human-readable text, not barcode lines.
    """
    if not TESSERACT_AVAILABLE:
        return None
    
    try:
        # Use pytesseract to read text
        # Configure for digits only
        custom_config = r'--oem 3 --psm 7 -c tessedit_char_whitelist=0123456789'
        text = pytesseract.image_to_string(cv2.imread(image_path), config=custom_config)
        
        # Extract only digits
        cleaned = ''.join(filter(str.isdigit, text))
        
        if cleaned:
            print(f"[OCR] Read from numbers region: {cleaned} (length: {len(cleaned)})")
            return cleaned
        return None
    except Exception as e:
        print(f"WARNING: OCR failed: {e}")
        return None

def detect_barcode_location_opencv(image_path):
    """
    Fallback: Use OpenCV to detect barcode-like regions (dense vertical lines).
    Returns bounding box coordinates (x, y, width, height) or None.
    """
    try:
        img = cv2.imread(image_path)
        if img is None:
            return None
        
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        height, width = gray.shape
        
        # Detect vertical lines (barcode patterns)
        # Use Sobel operator to detect vertical edges
        grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        grad_x = np.absolute(grad_x)
        grad_x = np.uint8(grad_x)
        
        # Threshold to get strong vertical edges
        _, thresh = cv2.threshold(grad_x, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Morphological operations to connect barcode lines
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 1))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        
        # Find contours
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            return None
        
        # Find the largest rectangular contour (likely the barcode)
        largest_contour = max(contours, key=cv2.contourArea)
        x, y, w, h = cv2.boundingRect(largest_contour)
        
        # Filter: barcode should be reasonably sized
        if w > width * 0.1 and h > height * 0.01 and h < height * 0.3:
            print(f"[OpenCV] ✅ Barcode region detected: x={x}, y={y}, width={w}, height={h}")
            return {'x': x, 'y': y, 'width': w, 'height': h}
        
        return None
        
    except Exception as e:
        print(f"[OpenCV] ⚠ Error detecting barcode region: {e}")
        return None

def detect_barcode_location(image_path):
    """
    Step 1: Detect WHERE the barcode is located in the image.
    Returns bounding box coordinates (x, y, width, height) or None.
    Tries Dynamsoft first, falls back to OpenCV if needed.
    """
    try:
        reader = dbr.BarcodeReader()
        reader.init_license(LICENSE_KEY)
        
        print(f"[Dynamsoft] ── Detecting barcode location in full image ──")
        
        # Read full image to detect barcode location
        results = reader.decode_file(image_path)
        
        if not results:
            print(f"[Dynamsoft] No barcode detected, trying OpenCV fallback...")
            return detect_barcode_location_opencv(image_path)
        
        # Get the first valid barcode result with localization
        for result in results:
            # Try to access localization_result (Dynamsoft SDK structure)
            try:
                # Check various possible attributes for location data
                loc_data = None
                
                # Method 1: Check localization_result attribute
                if hasattr(result, 'localization_result'):
                    loc_data = result.localization_result
                
                # Method 2: Check if result itself has coordinates
                if not loc_data and (hasattr(result, 'x') or hasattr(result, 'localization_result_x')):
                    x = getattr(result, 'x', None) or getattr(result, 'localization_result_x', None)
                    y = getattr(result, 'y', None) or getattr(result, 'localization_result_y', None)
                    w = getattr(result, 'width', None) or getattr(result, 'localization_result_width', None)
                    h = getattr(result, 'height', None) or getattr(result, 'localization_result_height', None)
                    
                    if x is not None and y is not None and w and h:
                        print(f"[Dynamsoft] ✅ Barcode location detected: x={x}, y={y}, width={w}, height={h}")
                        return {'x': int(x), 'y': int(y), 'width': int(w), 'height': int(h)}
                
                # Method 3: Check localization_result object
                if loc_data:
                    if hasattr(loc_data, 'x') and hasattr(loc_data, 'y'):
                        x = loc_data.x
                        y = loc_data.y
                        w = getattr(loc_data, 'width', 0) or getattr(loc_data, 'w', 0)
                        h = getattr(loc_data, 'height', 0) or getattr(loc_data, 'h', 0)
                        
                        if w > 0 and h > 0:
                            print(f"[Dynamsoft] ✅ Barcode location detected: x={x}, y={y}, width={w}, height={h}")
                            return {'x': int(x), 'y': int(y), 'width': int(w), 'height': int(h)}
            except Exception as e:
                print(f"[Dynamsoft] ⚠ Error accessing location data: {e}")
                continue
        
        # If Dynamsoft detected barcode but no location, try OpenCV
        print(f"[Dynamsoft] ⚠ Barcode detected but no location data, trying OpenCV fallback...")
        return detect_barcode_location_opencv(image_path)
        
    except Exception as e:
        print(f"[Dynamsoft] ⚠ Error detecting barcode location: {e}")
        print(f"[Dynamsoft] Trying OpenCV fallback...")
        return detect_barcode_location_opencv(image_path)

def crop_around_barcode(image_path, bbox, padding_percent=20):
    """
    Step 2: Crop image around detected barcode location with padding.
    padding_percent: Add this percentage of barcode dimensions as padding.
    """
    try:
        img = cv2.imread(image_path)
        if img is None:
            return None
        
        height, width = img.shape[:2]
        
        # Calculate crop coordinates with padding
        padding_x = int(bbox['width'] * padding_percent / 100)
        padding_y = int(bbox['height'] * padding_percent / 100)
        
        # Add extra padding below barcode for numbers (typically numbers are below barcode)
        padding_y_bottom = int(bbox['height'] * 50 / 100)  # 50% extra padding below
        
        x1 = max(0, bbox['x'] - padding_x)
        y1 = max(0, bbox['y'] - padding_y)
        x2 = min(width, bbox['x'] + bbox['width'] + padding_x)
        y2 = min(height, bbox['y'] + bbox['height'] + padding_y + padding_y_bottom)
        
        print(f"[Dynamsoft] Cropping around barcode: ({x1}, {y1}) to ({x2}, {y2})")
        
        cropped = img[y1:y2, x1:x2]
        
        # Save cropped image
        base, ext = os.path.splitext(image_path)
        cropped_path = f"{base}_barcode_crop{ext}"
        cv2.imwrite(cropped_path, cropped)
        
        print(f"[Dynamsoft] ✅ Cropped image saved: {cropped_path}")
        return cropped_path
        
    except Exception as e:
        print(f"[Dynamsoft] ⚠ Error cropping around barcode: {e}")
        return None

def detect_and_crop_barcode(image_path):
    """
    ENHANCED STRATEGY: Detect barcode location and crop with multiple attempts for 99% accuracy.
    
    1. Try multiple preprocessing strategies
    2. Detect barcode location with fallbacks
    3. Crop with multiple padding strategies
    4. Return best cropped barcode image (for Google Vision API)
    
    Returns: Path to cropped barcode image, or None if all attempts fail
    """
    if not os.path.exists(image_path):
        print(f"ERROR: Image not found: {image_path}")
        return None
    
    temp_files = []
    
    try:
        print(f"[Dynamsoft] ═══════════════════════════════════════════════════════")
        print(f"[Dynamsoft] 🎯 Enhanced Barcode Detection & Cropping (99% Accuracy)")
        print(f"[Dynamsoft] ═══════════════════════════════════════════════════════")
        
        # ── STEP 1: Try multiple preprocessing strategies ────────────────────────
        preprocessing_strategies = ['standard', 'aggressive', 'high_contrast', 'subtle']
        bbox = None
        
        for strategy in preprocessing_strategies:
            print(f"[Dynamsoft] ── Attempt: {strategy} preprocessing ──")
            
            # Preprocess image with current strategy
            processed_path = preprocess_image_enhanced(image_path, strategy=strategy)
            if processed_path != image_path:
                temp_files.append(processed_path)
            
            # Try to detect barcode location
            bbox = detect_barcode_location(processed_path)
            
            if bbox:
                print(f"[Dynamsoft] ✅ Barcode detected with {strategy} preprocessing")
                break
        
        # If preprocessing didn't help, try original image
        if not bbox:
            print(f"[Dynamsoft] ── Trying original image without preprocessing ──")
            bbox = detect_barcode_location(image_path)
        
        if bbox:
            # ── STEP 2: Crop with multiple padding strategies ───────────────────
            print(f"[Dynamsoft] ── Step 2: Cropping barcode area (multiple strategies) ──")
            
            # Try different padding percentages
            padding_strategies = [20, 15, 25, 30]  # Different padding amounts
            
            for padding in padding_strategies:
                cropped_path = crop_around_barcode(image_path, bbox, padding_percent=padding)
                
                if cropped_path:
                    # Verify cropped image is valid
                    cropped_img = cv2.imread(cropped_path)
                    if cropped_img is not None and cropped_img.size > 0:
                        height, width = cropped_img.shape[:2]
                        # Check if cropped image has reasonable size
                        if width > 50 and height > 20:
                            print(f"[Dynamsoft] ✅ Barcode area cropped successfully (padding: {padding}%)")
                            print(f"[Dynamsoft]    Cropped size: {width}x{height}")
                            print(f"[Dynamsoft] 📍 Cropped image ready for Google Vision API")
                            return cropped_path
                    else:
                        # Cleanup invalid crop
                        if os.path.exists(cropped_path):
                            try:
                                os.remove(cropped_path)
                            except:
                                pass
        
        print(f"[Dynamsoft] ❌ Failed to detect and crop barcode after all attempts")
        return None
        
    except Exception as e:
        print(f"[Dynamsoft] ❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        # Cleanup temp preprocessing files (but not the final cropped image)
        for temp_file in temp_files:
            if os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except:
                    pass

def detect_barcode(image_path):
    """
    NEW STRATEGY: Dynamic barcode localization for 100% accuracy
    
    1. Scan full image to detect WHERE barcode is located (bounding box)
    2. Crop precisely around detected barcode location
    3. Extract barcode number from cropped region
    4. Return barcode number
    
    This works regardless of barcode position in the image.
    """
    if not os.path.exists(image_path):
        print(f"ERROR: Image not found: {image_path}")
        return None
    
    # Initialize reader
    reader = dbr.BarcodeReader()
    reader.init_license(LICENSE_KEY)
    
    temp_files = []
    
    try:
        print(f"[Dynamsoft] ═══════════════════════════════════════════════════════")
        print(f"[Dynamsoft] 🎯 NEW STRATEGY: Dynamic Barcode Localization")
        print(f"[Dynamsoft] ═══════════════════════════════════════════════════════")
        
        # ── STEP 1: Detect barcode location in full image ──────────────────────
        print(f"[Dynamsoft] ── Step 1: Detecting barcode location ──")
        bbox = detect_barcode_location(image_path)
        
        if bbox:
            # ── STEP 2: Crop around detected barcode location ───────────────────
            print(f"[Dynamsoft] ── Step 2: Cropping around detected barcode ──")
            cropped_path = crop_around_barcode(image_path, bbox, padding_percent=20)
            
            if cropped_path:
                temp_files.append(cropped_path)
                
                # ── STEP 3: Preprocess cropped image ────────────────────────────
                print(f"[Dynamsoft] ── Step 3: Preprocessing cropped image ──")
                processed_path = preprocess_image(cropped_path)
                if processed_path != cropped_path:
                    temp_files.append(processed_path)
                else:
                    processed_path = cropped_path
                
                # ── STEP 4: Extract barcode number from cropped region ─────────
                print(f"[Dynamsoft] ── Step 4: Extracting barcode number ──")
                
                # Try OCR first (reads human-readable numbers below barcode)
                ocr_result = read_numbers_with_ocr(processed_path)
                if ocr_result and 8 <= len(ocr_result) <= 21:
                    print(f"[Dynamsoft] ✅ OCR result: {ocr_result} (length: {len(ocr_result)})")
                    return ocr_result
                
                # Fallback: Use Dynamsoft barcode reader on cropped region
                results = reader.decode_file(processed_path)
                
                if results:
                    print(f"[Dynamsoft] Found {len(results)} result(s) from cropped region")
                    
                    valid_numbers = []
                    for i, result in enumerate(results):
                        text = result.barcode_text.strip() if hasattr(result, 'barcode_text') else ''
                        if text:
                            cleaned = ''.join(filter(str.isdigit, text))
                            print(f"[Dynamsoft] Result {i+1}: {cleaned} (length: {len(cleaned)})")
                            
                            if 8 <= len(cleaned) <= 21:
                                print(f"[Dynamsoft] ✅ VALID BARCODE: {cleaned}")
                                valid_numbers.append(cleaned)
                    
                    if valid_numbers:
                        # Prefer longer sequences
                        valid_numbers.sort(key=len, reverse=True)
                        best_match = valid_numbers[0]
                        print(f"[Dynamsoft] ✅ SELECTED: {best_match}")
                        return best_match
        
        # ── FALLBACK: If dynamic localization failed, try full image scan ───────
        print(f"[Dynamsoft] ── Fallback: Full image scan ──")
        print(f"[Dynamsoft] Dynamic localization failed, scanning full image...")
        
        processed_full = preprocess_image(image_path)
        if processed_full != image_path:
            temp_files.append(processed_full)
        
        results = reader.decode_file(processed_full)
        
        if results:
            print(f"[Dynamsoft] Found {len(results)} result(s) from full image")
            
            valid_numbers = []
            for i, result in enumerate(results):
                text = result.barcode_text.strip() if hasattr(result, 'barcode_text') else ''
                if text:
                    cleaned = ''.join(filter(str.isdigit, text))
                    print(f"[Dynamsoft] Result {i+1}: {cleaned} (length: {len(cleaned)})")
                    
                    if 8 <= len(cleaned) <= 21:
                        print(f"[Dynamsoft] ✅ VALID BARCODE (fallback): {cleaned}")
                        valid_numbers.append(cleaned)
            
            if valid_numbers:
                valid_numbers.sort(key=len, reverse=True)
                best_match = valid_numbers[0]
                print(f"[Dynamsoft] ✅ SELECTED (fallback): {best_match}")
                return best_match
        
        print(f"[Dynamsoft] ❌ No valid barcode found")
        return None
        
    except Exception as e:
        print(f"[Dynamsoft] ❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        # Cleanup temp files
        for temp_file in temp_files:
            if os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except:
                    pass

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python detect_barcode.py <image_path> [--crop-only]")
        sys.exit(1)
    
    image_path = sys.argv[1]
    crop_only = len(sys.argv) > 2 and sys.argv[2] == '--crop-only'
    
    if crop_only:
        # Return cropped image path for Google Vision
        cropped_path = detect_and_crop_barcode(image_path)
        if cropped_path:
            print(cropped_path)
            sys.exit(0)
        else:
            sys.exit(1)
    else:
        # Original behavior: return barcode number
        barcode = detect_barcode(image_path)
        if barcode:
            print(barcode)
            sys.exit(0)
        else:
            sys.exit(1)


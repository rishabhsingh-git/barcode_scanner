import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { X, ChevronLeft, ChevronRight, Check, Crop as CropIcon, Loader2, Eye } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { toast } from 'sonner';

interface BarcodeCropSliderProps {
  files: File[];
  onComplete: (crops: Map<number, Blob>) => void;
  onCancel: () => void;
}

/**
 * Barcode Crop Slider Component
 * 
 * Allows users to manually crop barcode regions from each selected image.
 * Uses react-easy-crop for stable, React-native cropping with better UX.
 */
export function BarcodeCropSlider({ files, onComplete, onCancel }: BarcodeCropSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [crops, setCrops] = useState<Map<number, Blob>>(new Map());
  const [imageUrls, setImageUrls] = useState<Map<number, string>>(new Map());
  const [completedIndices, setCompletedIndices] = useState<Set<number>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Map<number, string>>(new Map());
  
  // react-easy-crop state
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  
  const imageRef = useRef<HTMLImageElement>(null);
  const imageDimensionsRef = useRef<Map<number, { width: number; height: number }>>(new Map());

  const currentImageUrl = imageUrls.get(currentIndex);
  const isCompleted = completedIndices.has(currentIndex);
  const allCompleted = crops.size === files.length;

  // Load image URLs for all files
  useEffect(() => {
    console.log('[BarcodeCropSlider] Loading image URLs for', files.length, 'files');
    const urls = new Map<number, string>();
    files.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      urls.set(index, url);
    });
    setImageUrls(urls);

    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [files]);

  // Reset crop state when image changes
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    
    // Load image dimensions when image changes
    if (currentImageUrl && imageRef.current) {
      const img = new Image();
      img.onload = () => {
        imageDimensionsRef.current.set(currentIndex, {
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        console.log(`[BarcodeCropSlider] Image ${currentIndex + 1} dimensions: ${img.naturalWidth}x${img.naturalHeight}`);
      };
      img.src = currentImageUrl;
    }
  }, [currentIndex, currentImageUrl]);

  // Helper function to resize and compress image
  const resizeAndCompressImage = useCallback((
    sourceCanvas: HTMLCanvasElement,
    maxDimension: number = 3000,
    maxSizeBytes: number = 20 * 1024 * 1024,
    initialQuality: number = 0.92
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const sourceWidth = sourceCanvas.width;
      const sourceHeight = sourceCanvas.height;
      
      let newWidth = sourceWidth;
      let newHeight = sourceHeight;
      
      if (sourceWidth > maxDimension || sourceHeight > maxDimension) {
        if (sourceWidth > sourceHeight) {
          newWidth = maxDimension;
          newHeight = Math.round((sourceHeight / sourceWidth) * maxDimension);
        } else {
          newHeight = maxDimension;
          newWidth = Math.round((sourceWidth / sourceHeight) * maxDimension);
        }
      }
      
      const resizedCanvas = document.createElement('canvas');
      resizedCanvas.width = newWidth;
      resizedCanvas.height = newHeight;
      const resizedCtx = resizedCanvas.getContext('2d');
      
      if (!resizedCtx) {
        reject(new Error('Failed to create resized canvas context'));
        return;
      }
      
      resizedCtx.imageSmoothingEnabled = true;
      resizedCtx.imageSmoothingQuality = 'high';
      resizedCtx.drawImage(sourceCanvas, 0, 0, newWidth, newHeight);
      
      const tryCompress = (quality: number): void => {
        resizedCanvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          
          if (blob.size > maxSizeBytes && quality > 0.75) {
            tryCompress(Math.max(0.75, quality - 0.05));
          } else {
            resolve(blob);
          }
        }, 'image/jpeg', quality);
      };
      
      tryCompress(initialQuality);
    });
  }, []);

  // Create cropped image from area
  const createCroppedImage = useCallback(async (
    imageSrc: string,
    pixelArea: Area
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      
      image.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // Set canvas size to cropped area
          canvas.width = pixelArea.width;
          canvas.height = pixelArea.height;

          // Enable high-quality rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw the cropped portion of the image
          ctx.drawImage(
            image,
            pixelArea.x,
            pixelArea.y,
            pixelArea.width,
            pixelArea.height,
            0,
            0,
            pixelArea.width,
            pixelArea.height
          );

          // Validate canvas has content
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let totalNonWhitePixels = 0;
          let darkPixels = 0;

          for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            const a = imageData.data[i + 3];
            
            if (a > 10 && (r < 245 || g < 245 || b < 245)) {
              totalNonWhitePixels++;
            }
            
            if (a > 10 && (r < 150 || g < 150 || b < 150)) {
              darkPixels++;
            }
          }

          const totalPixels = imageData.data.length / 4;
          const contentPercentage = (totalNonWhitePixels / totalPixels) * 100;
          const darkPercentage = (darkPixels / totalPixels) * 100;

          console.log('[BarcodeCropSlider] Canvas content check:', {
            canvasSize: `${canvas.width}x${canvas.height}`,
            contentPercentage: contentPercentage.toFixed(2) + '%',
            darkPercentage: darkPercentage.toFixed(2) + '%',
            hasContent: contentPercentage > 1 || darkPercentage > 0.5
          });

          if (darkPercentage < 0.5 && contentPercentage < 1) {
            reject(new Error('Cropped area appears to be empty or white. Please ensure the crop box is over the barcode (black lines).'));
            return;
          }

          // Compress and resize
          const compressedBlob = await resizeAndCompressImage(canvas, 3000, 20 * 1024 * 1024, 0.95);
          
          if (compressedBlob.size < 2000) {
            reject(new Error(`Cropped image is too small (${(compressedBlob.size / 1024).toFixed(2)}KB). The selected area appears to be blank.`));
            return;
          }

          resolve(compressedBlob);
        } catch (error) {
          reject(error);
        }
      };

      image.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      image.src = imageSrc;
    });
  }, [resizeAndCompressImage]);

  const handleCropComplete = useCallback(async () => {
    if (!currentImageUrl || !croppedAreaPixels) {
      toast.error('Please select a crop area first');
      return;
    }

    try {
      console.log('[BarcodeCropSlider] Crop area pixels:', croppedAreaPixels);
      
      const blob = await createCroppedImage(currentImageUrl, croppedAreaPixels);
      
      console.log('[BarcodeCropSlider] Crop blob created:', blob.size, 'bytes for image', currentIndex + 1);
      
      setCrops(prev => {
        const newMap = new Map(prev);
        newMap.set(currentIndex, blob);
        return newMap;
      });
      
      setCompletedIndices(prev => {
        const newSet = new Set(prev);
        newSet.add(currentIndex);
        
        const nextUncropped = files.findIndex((_, idx) => !newSet.has(idx) && idx !== currentIndex);
        if (nextUncropped !== -1) {
          setTimeout(() => setCurrentIndex(nextUncropped), 100);
        }
        
        return newSet;
      });
      
      toast.success(`Barcode cropped for image ${currentIndex + 1}`);
    } catch (error: any) {
      console.error('[BarcodeCropSlider] Error cropping image:', error);
      toast.error('Failed to process cropped image: ' + (error.message || 'Unknown error'));
    }
  }, [currentIndex, currentImageUrl, croppedAreaPixels, files, createCroppedImage]);

  const handleCropChange = useCallback((crop: Point) => {
    setCrop(crop);
  }, []);

  const handleZoomChange = useCallback((zoom: number) => {
    setZoom(zoom);
  }, []);

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    console.log('[BarcodeCropSlider] Crop complete:', { croppedArea, croppedAreaPixels });
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handlePrevious = () => {
    setCurrentIndex(prev => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex(prev => Math.min(files.length - 1, prev + 1));
  };

  // Create preview URLs from cropped blobs
  useEffect(() => {
    if (showPreview && crops.size > 0) {
      const urls = new Map<number, string>();
      crops.forEach((blob, index) => {
        try {
          if (!blob || blob.size === 0) {
            console.error(`[BarcodeCropSlider] Invalid blob for index ${index}:`, blob);
            return;
          }
          
          const url = URL.createObjectURL(blob);
          urls.set(index, url);
          console.log(`[BarcodeCropSlider] Created preview URL for index ${index}, blob size:`, blob.size);
        } catch (error) {
          console.error(`[BarcodeCropSlider] Failed to create preview URL for index ${index}:`, error);
        }
      });
      setPreviewUrls(urls);
      
      return () => {
        urls.forEach(url => {
          try {
            URL.revokeObjectURL(url);
          } catch (error) {
            console.error('[BarcodeCropSlider] Error revoking URL:', error);
          }
        });
        setPreviewUrls(new Map());
      };
    } else if (!showPreview) {
      setPreviewUrls(new Map());
    }
  }, [showPreview, crops]);

  const handleViewPreview = () => {
    if (crops.size !== files.length) {
      toast.error(`Please crop all ${files.length} images before viewing preview`);
      return;
    }
    setShowPreview(true);
  };

  const handleClosePreview = () => {
    setShowPreview(false);
  };

  const handleCompleteAll = () => {
    if (crops.size !== files.length) {
      toast.error(`Please crop all ${files.length} images before proceeding`);
      return;
    }
    onComplete(crops);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  // Preview modal content
  const previewModalContent = (
    <AnimatePresence>
      {showPreview && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center bg-black/95 backdrop-blur-md z-[99999]"
          style={{
            zIndex: 99999,
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleClosePreview();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative w-full max-w-6xl max-h-[90vh] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Card className="glass border-white/20">
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle className="flex items-center gap-3">
                  <Eye className="h-6 w-6 text-neon-cyan" />
                  <span>Preview All Cropped Images</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    ({crops.size} images)
                  </span>
                </CardTitle>
                <button
                  onClick={handleClosePreview}
                  className="rounded-full p-2 hover:bg-white/10 transition-colors"
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-4 py-3 text-sm">
                  <p className="text-yellow-400 font-medium mb-1">ℹ️ Why cropped images can be large:</p>
                  <p className="text-muted-foreground text-xs">
                    Even after cropping, if the original image is very high resolution (e.g., 50MP camera), 
                    the cropped area can still be large. Images are automatically resized and compressed to 
                    ensure they're under 20MB before upload (Google Vision API limit: 40MB). Quality is 
                    maintained at 92% to ensure accurate barcode detection.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[60vh] overflow-y-auto p-2">
                  {Array.from({ length: files.length }).map((_, idx) => {
                    const cropBlob = crops.get(idx);
                    const previewUrl = previewUrls.get(idx);
                    const originalFile = files[idx];
                    
                    return (
                      <div
                        key={idx}
                        className="relative rounded-lg border border-white/10 bg-black/20 p-2 hover:border-neon-cyan/50 transition-colors"
                      >
                        <div className="aspect-square relative overflow-hidden rounded mb-2 bg-black/40">
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={`Cropped ${idx + 1}`}
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                console.error('[Preview] Failed to load image:', idx);
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : cropBlob ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <Loader2 className="h-6 w-6 animate-spin text-neon-cyan" />
                            </div>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                              No crop
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-foreground truncate">
                            Image {idx + 1}
                          </p>
                          <p className="text-xs text-muted-foreground truncate" title={originalFile.name}>
                            {originalFile.name}
                          </p>
                          {cropBlob && (
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Size:</span>
                              <span className={`text-xs font-mono ${
                                cropBlob.size > 15 * 1024 * 1024
                                  ? 'text-yellow-400'
                                  : cropBlob.size > 20 * 1024 * 1024
                                  ? 'text-red-400'
                                  : 'text-neon-green'
                              }`}>
                                {formatFileSize(cropBlob.size)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-neon-cyan">Total Images: {crops.size}</p>
                    <p className="text-xs text-muted-foreground">
                      Total Size: {formatFileSize(
                        Array.from(crops.values()).reduce((sum, blob) => sum + blob.size, 0)
                      )}
                    </p>
                  </div>
                  <Button
                    variant="neon"
                    onClick={() => {
                      handleClosePreview();
                      handleCompleteAll();
                    }}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Upload All
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const modalContent = files.length === 0 ? (
    <div
      className="fixed inset-0 flex items-center justify-center bg-red-900/90"
      style={{ zIndex: 99999 }}
    >
      <div className="text-white p-8 bg-red-800 rounded-lg">
        <p className="text-xl font-bold">ERROR: No files provided to crop slider!</p>
      </div>
    </div>
  ) : (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/95 backdrop-blur-md"
      style={{
        zIndex: 99999,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      // Removed onClick handler - modal only closes via X button or Cancel button
      // This prevents accidental closing while dragging/cropping
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="relative w-full max-w-7xl max-h-[95vh] mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="glass border-white/20 flex flex-col max-h-[95vh]">
          <CardHeader className="flex flex-row items-center justify-between pb-4 flex-shrink-0">
            <CardTitle className="flex items-center gap-3">
              <CropIcon className="h-6 w-6 text-neon-cyan" />
              <span>Crop Barcode Regions</span>
              <span className="text-sm font-normal text-muted-foreground">
                ({currentIndex + 1} of {files.length})
              </span>
            </CardTitle>
            <button
              onClick={onCancel}
              className="rounded-full p-2 hover:bg-white/10 transition-colors"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </CardHeader>
          <CardContent className="space-y-4 overflow-y-auto flex-1 min-h-0">
            {/* Image cropper */}
            <div 
              className="relative bg-black/20 rounded-lg"
              style={{
                height: "60vh",
                minHeight: "400px",
                maxHeight: "60vh",
                width: "100%",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {!currentImageUrl ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-neon-cyan mx-auto mb-2" />
                    <p className="text-muted-foreground">Loading image {currentIndex + 1} of {files.length}...</p>
                  </div>
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentIndex}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full"
                    style={{
                      width: '100%',
                      height: '100%',
                      position: 'relative',
                    }}
                  >
                    <Cropper
                      image={currentImageUrl}
                      crop={crop}
                      zoom={zoom}
                      aspect={undefined}
                      onCropChange={handleCropChange}
                      onZoomChange={handleZoomChange}
                      onCropComplete={onCropComplete}
                      cropShape="rect"
                      showGrid={true}
                      style={{
                        containerStyle: {
                          width: '100%',
                          height: '100%',
                          position: 'relative',
                        },
                        cropAreaStyle: {
                          border: '2px solid rgba(0, 240, 255, 0.8)',
                          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                        },
                        mediaStyle: {
                          objectFit: 'contain' as const,
                        },
                      }}
                    />
                  </motion.div>
                </AnimatePresence>
              )}

              {/* Navigation arrows */}
              {files.length > 1 && (
                <>
                  <button
                    onClick={handlePrevious}
                    disabled={currentIndex === 0}
                    className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/70 hover:bg-black/90 p-3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors z-10"
                  >
                    <ChevronLeft className="h-6 w-6 text-white" />
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={currentIndex === files.length - 1}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/70 hover:bg-black/90 p-3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors z-10"
                  >
                    <ChevronRight className="h-6 w-6 text-white" />
                  </button>
                </>
              )}
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-4">
              <label className="text-sm text-muted-foreground min-w-[60px]">Zoom:</label>
              <input
                type="range"
                min={1}
                max={4}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground min-w-[40px] text-right">
                {Math.round(zoom * 100)}%
              </span>
            </div>

            {/* Progress indicator */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">Progress:</span>
              {files.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-2 w-8 rounded ${
                    completedIndices.has(idx)
                      ? 'bg-neon-green'
                      : idx === currentIndex
                      ? 'bg-neon-cyan'
                      : 'bg-white/20'
                  }`}
                  title={`Image ${idx + 1}${completedIndices.has(idx) ? ' (cropped)' : ''}`}
                />
              ))}
              <span className="text-sm text-muted-foreground ml-auto">
                {completedIndices.size} / {files.length} cropped
              </span>
            </div>

            {/* Instructions */}
            <div className="rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 px-4 py-3 text-sm">
              <p className="text-neon-cyan font-medium mb-1">Instructions:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Drag the crop rectangle to select the barcode area</li>
                <li>Resize by dragging the corners or edges</li>
                <li>Use the zoom slider or mouse wheel to zoom in/out for precision</li>
                <li>Click "Save Crop" to confirm, then repeat for all images</li>
              </ol>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              <Button
                variant="neon"
                onClick={handleCropComplete}
                disabled={isCompleted || !croppedAreaPixels}
                className="w-full text-lg py-6"
                size="lg"
              >
                <CropIcon className="mr-2 h-5 w-5" />
                {isCompleted ? 'Already Cropped ✓' : 'Save Crop'}
              </Button>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={onCancel}
                  className="flex-1"
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                {allCompleted && (
                  <Button
                    variant="outline"
                    onClick={handleViewPreview}
                    className="flex-1"
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View Preview
                  </Button>
                )}
                <Button
                  variant="neon"
                  onClick={handleCompleteAll}
                  disabled={!allCompleted}
                  className="flex-1"
                >
                  <Check className="mr-2 h-4 w-4" />
                  Upload All ({completedIndices.size}/{files.length})
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );

  // Render modals using portal to document body
  if (typeof document !== 'undefined') {
    return (
      <>
        {createPortal(modalContent, document.body)}
        {createPortal(previewModalContent, document.body)}
      </>
    );
  }

  return null;
}

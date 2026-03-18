import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, ImageIcon, X, Crop as CropIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { formatNumber } from '../lib/utils';
import { BarcodeCropSlider } from './BarcodeCropSlider';

/**
 * Upload Panel Component
 *
 * Drag-and-drop zone for bulk image uploads.
 * Supports thousands of images with progress tracking.
 */
export function UploadPanel() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [showCropSlider, setShowCropSlider] = useState(false);


  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    try {
      // Handle rejected files (too large, wrong type, etc.)
      if (rejectedFiles.length > 0) {
        const tooLarge = rejectedFiles.filter(f => f.errors?.some((e: any) => e.code === 'file-too-large'));
        const wrongType = rejectedFiles.filter(f => f.errors?.some((e: any) => e.code === 'file-invalid-type'));
        
        if (tooLarge.length > 0) {
          toast.error(`${tooLarge.length} file(s) too large (max 2GB per file)`);
        }
        if (wrongType.length > 0) {
          toast.error(`${wrongType.length} file(s) are not images`);
        }
      }
      
      // Only store file references - NEVER read files into memory
      // File reading happens during upload, not on selection
      const totalBytes = acceptedFiles.reduce((sum, f) => {
        try {
          return sum + (f.size || 0);
        } catch {
          return sum;
        }
      }, 0);
      
      let sizeDisplay = '';
      if (totalBytes > 1024 * 1024 * 1024) {
        sizeDisplay = ` (${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB total)`;
      } else {
        sizeDisplay = ` (${(totalBytes / (1024 * 1024)).toFixed(1)} MB total)`;
      }
      
      if (acceptedFiles.length > 0) {
        setSelectedFiles(acceptedFiles);
        setShowCropSlider(false); // Ensure slider is closed when new files are selected
        toast.info(
          `${acceptedFiles.length} image(s) selected${sizeDisplay}. Open the cropper to save crops per-image.`,
        );
      }
    } catch (error: any) {
      console.error('[UploadPanel] Error handling file selection:', error);
      toast.error('Error selecting files: ' + (error.message || 'Unknown error'));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp', '.tiff'] },
    disabled: showCropSlider, // Disable when crop slider is open
    maxFiles: 100000, // Support massive batches
    maxSize: 2 * 1024 * 1024 * 1024, // 2GB per file (supports 1GB+ images)
    noClick: false,
    noKeyboard: false,
    // CRITICAL: Don't read files into memory on selection
    // Only store file references - actual reading happens during upload
    useFsAccessApi: false, // Disable File System Access API to prevent memory issues
    preventDropOnDocument: true,
  });

  // Add direct input change handler as backup
  const inputProps = getInputProps();
  const enhancedInputProps = {
    ...inputProps,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      // Call original onChange if it exists
      if (inputProps.onChange) {
        inputProps.onChange(e);
      }
      // Also handle files directly as backup
      if (e.target.files && e.target.files.length > 0) {
        onDrop(Array.from(e.target.files), []);
      }
    },
  };

  const handleCropCancel = () => {
    setShowCropSlider(false);
  };

  const clearFiles = () => {
    setSelectedFiles([]);
    setShowCropSlider(false);
  };

  // Clear local UI state when user resets the batch from the Download section
  useEffect(() => {
    const onReset = () => {
      clearFiles();
      toast.info('Selection cleared after reset');
    };
    window.addEventListener('barocode:reset', onReset as EventListener);
    return () => window.removeEventListener('barocode:reset', onReset as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="glass border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan/20 to-neon-purple/20 neon-glow-cyan">
            <Upload className="h-5 w-5 text-neon-cyan" />
          </div>
          <span>Upload Images</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          {...getRootProps()}
          className={`
            relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center
            rounded-xl border-2 border-dashed p-8 transition-all duration-300
            ${isDragActive
              ? 'border-neon-cyan bg-neon-cyan/5 neon-glow-cyan'
              : 'border-white/20 hover:border-neon-cyan/50 hover:bg-white/5'
            }
          `}
        >
          <input {...enhancedInputProps} />

          <AnimatePresence mode="wait">
            {isDragActive ? (
              <motion.div
                key="drag"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="flex flex-col items-center gap-3"
              >
                <ImageIcon className="h-12 w-12 text-neon-cyan animate-pulse-glow" />
                <p className="text-neon-cyan font-medium">Drop images here...</p>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="flex flex-col items-center gap-3 text-center"
              >
                <div className="rounded-full bg-white/5 p-4">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    Drag & drop images here
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    or click to browse — supports thousands of images
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Selected files info — shows file count + size and a button to open crop modal */}
        <AnimatePresence>
          {selectedFiles.length > 0 && !showCropSlider && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between rounded-lg px-4 py-3 bg-neon-cyan/10 border border-neon-cyan/20">
                <div className="flex items-center gap-2 flex-wrap">
                  <ImageIcon className="h-4 w-4 text-neon-cyan" />
                  <span className="text-sm font-medium">
                    {formatNumber(selectedFiles.length)} image{selectedFiles.length !== 1 ? 's' : ''} selected
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({(() => {
                      try {
                        const totalBytes = selectedFiles.reduce((a, f) => a + (f.size || 0), 0);
                        if (totalBytes > 1024 * 1024 * 1024) {
                          return (totalBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
                        }
                        return (totalBytes / (1024 * 1024)).toFixed(1) + ' MB';
                      } catch {
                        return 'calculating...';
                      }
                    })()})
                  </span>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowCropSlider(true);
                    }}
                  >
                    <CropIcon className="mr-2 h-4 w-4" />
                    Crop Images
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                
                  <button
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      e.preventDefault();
                      clearFiles(); 
                    }}
                    className="rounded-full p-1 hover:bg-white/10 transition-colors"
                    title="Clear selected files"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Upload progress bar */}
        {/* Processing starts per-image when user clicks Save Selection in the cropper */}

        {/* Upload button */}
        <Button
          variant="neon"
          size="lg"
          className="w-full"
          onClick={() => {
            if (selectedFiles.length === 0) {
              toast.error('No images selected');
              return;
            }
            setShowCropSlider(true);
          }}
          disabled={selectedFiles.length === 0 || showCropSlider}
        >
          <>
            <CropIcon className="mr-2 h-5 w-5" />
            Open Batch Cropper
          </>
        </Button>

        {/* Crop Slider Modal - Renders when showCropSlider is true */}
        <AnimatePresence>
          {showCropSlider && selectedFiles.length > 0 && (
            <BarcodeCropSlider
              key="crop-slider"
              files={selectedFiles}
              onCancel={handleCropCancel}
            />
          )}
        </AnimatePresence>

        {/* Success message */}
      </CardContent>
    </Card>
  );
}


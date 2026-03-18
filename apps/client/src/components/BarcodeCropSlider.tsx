import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ReactCrop, {
  type Crop,
  type PixelCrop,
  type PercentCrop,
  centerCrop,
  makeAspectCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
  X,
  Check,
  Crop as CropIcon,
  Loader2,
  Eye,
  Save,
  Trash2,
  Undo2,
  Redo2,
  Download,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardTitle } from './ui/card';
import { toast } from 'sonner';
import { useProgress } from '../hooks/useProgress';
import { useUpload } from '../hooks/useUpload';
import { downloadFailedZip, downloadZip, resetProgress } from '../services/api';

interface BarcodeCropSliderProps {
  files: File[];
  onCancel: () => void;
}

/**
 * Image Batch Cropper (snipping-tool style)
 *
 * - Center crop stage with click-drag to start crop from cursor
 * - Top toolbar (Save / Undo / Redo / aspect presets)
 * - Bottom scrollable thumbnail drawer to switch images
 * - Save Selection uploads + enqueues processing for ONLY the current image
 * - Live overall progress % shown from /jobs/progress polling
 */
export function BarcodeCropSlider({ files, onCancel }: BarcodeCropSliderProps) {
  // Manage the batch locally so we can remove items from the drawer
  const [items, setItems] = useState<File[]>(files);
  const [currentIndex, setCurrentIndex] = useState(0);
  // Thumbnails are small and generated progressively to keep UI responsive.
  const [thumbUrls, setThumbUrls] = useState<Map<number, string>>(new Map());
  // Center preview is generated only for the current image (high priority).
  const [centerPreviewUrl, setCenterPreviewUrl] = useState<string | null>(null);
  const centerCacheRef = useRef<Map<number, string>>(new Map());
  const thumbCacheRef = useRef<Map<number, string>>(new Map());
  const activeCenterTokenRef = useRef(0);

  const [cropByIndex, setCropByIndex] = useState<Map<number, Crop>>(new Map());
  const [pixelCropByIndex, setPixelCropByIndex] = useState<Map<number, PixelCrop>>(new Map());
  const [percentCropByIndex, setPercentCropByIndex] = useState<Map<number, PercentCrop>>(new Map());

  const [completedIndices, setCompletedIndices] = useState<Set<number>>(new Set());
  const [uploadingIndices, setUploadingIndices] = useState<Set<number>>(new Set());

  const [showPreview, setShowPreview] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Undo/redo stacks per image
  const undoStackRef = useRef<Map<number, Crop[]>>(new Map());
  const redoStackRef = useRef<Map<number, Crop[]>>(new Map());
  const lastCommittedCropRef = useRef<Map<number, Crop>>(new Map());
  const loadedIndicesRef = useRef<Set<number>>(new Set());
  const [, forceRender] = useState(0);

  const { uploadOneWithCrop } = useUpload();
  const { data: progress } = useProgress(true);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [isDownloadingFailedZip, setIsDownloadingFailedZip] = useState(false);

  const [aspectMode, setAspectMode] = useState<'free' | '3:2' | '16:9' | '1:1'>('free');
  const [zoom, setZoom] = useState(1); // 1 = fit (100%), >1 zooms in
  const aspect = useMemo(() => {
    if (aspectMode === '3:2') return 3 / 2;
    if (aspectMode === '16:9') return 16 / 9;
    if (aspectMode === '1:1') return 1;
    return undefined;
  }, [aspectMode]);

  const currentImageUrl = centerPreviewUrl;
  const currentCrop = cropByIndex.get(currentIndex);
  const currentPixelCrop = pixelCropByIndex.get(currentIndex);
  const currentPercentCrop = percentCropByIndex.get(currentIndex);

  const isCompleted = completedIndices.has(currentIndex);
  const isUploading = uploadingIndices.has(currentIndex);
  const allCompleted = items.length > 0 && completedIndices.size === items.length;
  // Enable download as soon as we have at least one processed image.
  // Do NOT require 100% completion because some images may fail, and we still want
  // the user to download whatever succeeded.
  const canDownloadProcessedZip = (progress?.processedImages ?? 0) > 0;
  const canDownloadFailedZip = (progress?.failedImages ?? 0) > 0;

  const handleDownloadProcessedZip = useCallback(async () => {
    try {
      setIsDownloadingZip(true);
      toast.info('Preparing processed ZIP...');
      await downloadZip();
      toast.success('Processed ZIP download started');
    } catch (e) {
      console.error('Processed ZIP download error:', e);
      toast.error('Failed to download processed ZIP');
    } finally {
      setIsDownloadingZip(false);
    }
  }, []);

  const handleDownloadFailedZip = useCallback(async () => {
    try {
      setIsDownloadingFailedZip(true);
      toast.info('Preparing failed images ZIP...');
      await downloadFailedZip();
      toast.success('Failed images ZIP download started');
    } catch (e) {
      console.error('Failed ZIP download error:', e);
      toast.error('Failed to download failed-images ZIP');
    } finally {
      setIsDownloadingFailedZip(false);
    }
  }, []);

  const canUndo = (undoStackRef.current.get(currentIndex)?.length || 0) > 0;
  const canRedo = (redoStackRef.current.get(currentIndex)?.length || 0) > 0;

  const clampZoom = useCallback((z: number) => Math.min(4, Math.max(1, z)), []);

  // Priority loading pipeline:
  // - Immediately build a center preview for the current image (high priority).
  // - Progressively build small thumbnails in idle time (low priority).
  useEffect(() => {
    let cancelled = false;
    const token = ++activeCenterTokenRef.current;

    const buildPreviewUrl = async (idx: number, maxDim: number, quality: number) => {
      const file = items[idx];
      // Decode image; we will scale down on canvas to keep UI snappy.
      const bitmap = await createImageBitmap(file);
      const origW = bitmap.width;
      const origH = bitmap.height;

      const scale = Math.min(1, maxDim / Math.max(origW, origH));
      const targetW = Math.max(1, Math.round(origW * scale));
      const targetH = Math.max(1, Math.round(origH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        return null;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      bitmap.close();

      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) return null;
      return URL.createObjectURL(blob);
    };

    // Immediately switch the UI to the cached preview (or blank) to avoid showing the previous image.
    const cached = centerCacheRef.current.get(currentIndex) || null;
    setCenterPreviewUrl(cached);
    loadedIndicesRef.current.delete(currentIndex);
    forceRender((x) => x + 1);

    // Center preview (high priority)
    (async () => {
      try {
        // If we already have it cached, we’re done.
        if (centerCacheRef.current.has(currentIndex)) {
          loadedIndicesRef.current.add(currentIndex);
          forceRender((x) => x + 1);
          return;
        }
        const url = await buildPreviewUrl(currentIndex, 2400, 0.88);
        if (cancelled || !url) return;
        if (activeCenterTokenRef.current !== token) {
          // stale load (user switched images)
          URL.revokeObjectURL(url);
          return;
        }
        centerCacheRef.current.set(currentIndex, url);
        setCenterPreviewUrl(url);
        loadedIndicesRef.current.add(currentIndex);
        forceRender((x) => x + 1);
      } catch {
        // fallback: show nothing until image loads elsewhere
      }
    })();

    // Thumbnails (idle, sequential)
    const schedule =
      (window as any).requestIdleCallback ||
      ((cb: any) => window.setTimeout(() => cb({ timeRemaining: () => 10 }), 30));

    const thumbTarget = 320;
    let nextIdx = 0;
    const run = () => {
      if (cancelled) return;
      schedule(async (deadline: any) => {
        if (cancelled) return;
        while (deadline.timeRemaining() > 5 && nextIdx < items.length) {
          const idx = nextIdx++;
          if (thumbCacheRef.current.has(idx)) continue;
          try {
            const turl = await buildPreviewUrl(idx, thumbTarget, 0.8);
            if (cancelled || !turl) continue;
            // If another idle pass already created it, discard.
            if (thumbCacheRef.current.has(idx)) {
              URL.revokeObjectURL(turl);
              continue;
            }
            thumbCacheRef.current.set(idx, turl);
            setThumbUrls((prev) => {
              const nm = new Map(prev);
              nm.set(idx, turl);
              return nm;
            });
          } catch {
            // ignore
          }
        }
        if (nextIdx < items.length) run();
      });
    };
    run();

    return () => {
      cancelled = true;
    };
    // NOTE: thumbUrls intentionally excluded to avoid churn; generation is best-effort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, items]);

  // Cleanup thumbnails/center preview on unmount
  useEffect(() => {
    return () => {
      thumbUrls.forEach((u) => URL.revokeObjectURL(u));
      centerCacheRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset backend progress once per crop-session mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await resetProgress();
      } catch (e) {
        // Best-effort: if reset fails, we still allow cropping/processing
        if (!cancelled) console.warn('[BarcodeCropSlider] resetProgress failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed a default crop so handles show up immediately (user can still click-drag to create new crop)
  useEffect(() => {
    if (!currentImageUrl) return;
    if (cropByIndex.has(currentIndex)) return;
    const seeded: Crop = { unit: '%', x: 20, y: 40, width: 60, height: 20 };
    setCropByIndex((prev) => {
      const next = new Map(prev);
      next.set(currentIndex, seeded);
      return next;
    });
  }, [currentIndex, currentImageUrl, cropByIndex]);

  const pushUndo = useCallback((index: number, crop: Crop) => {
    const undo = undoStackRef.current.get(index) || [];
    undoStackRef.current.set(index, [...undo, crop]);
    redoStackRef.current.set(index, []);
  }, []);

  const commitCropForUndo = useCallback(
    (index: number, latest: Crop | undefined) => {
      if (!latest) return;
      const last = lastCommittedCropRef.current.get(index);
      if (!last) {
        lastCommittedCropRef.current.set(index, latest);
        return;
      }
      // Only commit if materially different to avoid churn
      const same =
        last.unit === latest.unit &&
        last.x === latest.x &&
        last.y === latest.y &&
        last.width === latest.width &&
        last.height === latest.height;
      if (!same) {
        pushUndo(index, last);
        lastCommittedCropRef.current.set(index, latest);
      }
    },
    [pushUndo],
  );

  const markLoaded = useCallback((idx: number) => {
    if (loadedIndicesRef.current.has(idx)) return;
    loadedIndicesRef.current.add(idx);
    // trigger a tiny re-render to hide skeleton without adding more state maps
    forceRender((x) => x + 1);
  }, []);

  const isLoaded = (idx: number) => loadedIndicesRef.current.has(idx);

  const Thumbnail = useMemo(() => {
    return memo(function ThumbnailButton(props: {
      idx: number;
      file: File;
      url: string | undefined;
      isActive: boolean;
      done: boolean;
      uploading: boolean;
      onSelect: (idx: number) => void;
      onRemove: (idx: number) => void;
    }) {
      const { idx, file, url, isActive, done, uploading, onSelect, onRemove } = props;
      return (
        <button
          onClick={() => onSelect(idx)}
          className={[
            'flex-shrink-0 w-[150px] rounded-xl border transition-all',
            isActive
              ? 'border-neon-cyan shadow-[0_0_0_2px_rgba(0,240,255,0.15)]'
              : 'border-white/10 hover:border-white/20',
            done ? 'ring-1 ring-neon-green/40' : '',
          ].join(' ')}
          title={file.name}
        >
          <div className="relative aspect-square rounded-xl overflow-hidden bg-black/30">
            {url ? (
              <img
                src={url}
                alt={file.name}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-neon-cyan" />
              </div>
            )}

            {/* Remove button */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove(idx);
              }}
              className="absolute top-2 left-2 rounded-full bg-black/60 hover:bg-black/80 border border-white/10 p-1 transition-colors"
              title="Remove from batch"
            >
              <Trash2 className="h-4 w-4 text-white/80" />
            </button>

                    {done && (
                      <div className="absolute top-2 right-2 rounded-full bg-neon-cyan/20 border border-neon-cyan/40 p-1">
                        <Check className="h-4 w-4 text-neon-cyan" />
                      </div>
                    )}
            {uploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-neon-cyan" />
              </div>
            )}
          </div>
          <div className="px-3 py-2 text-left">
            <div className="text-xs font-medium text-foreground truncate">Image {idx + 1}</div>
            <div className="text-[11px] text-muted-foreground truncate">{file.name}</div>
          </div>
        </button>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUndo = () => {
    const undo = undoStackRef.current.get(currentIndex) || [];
    const redo = redoStackRef.current.get(currentIndex) || [];
    const current = cropByIndex.get(currentIndex);
    if (!current || undo.length === 0) return;
    const prev = undo[undo.length - 1];
    undoStackRef.current.set(currentIndex, undo.slice(0, -1));
    redoStackRef.current.set(currentIndex, [...redo, current]);
    setCropByIndex((m) => {
      const nm = new Map(m);
      nm.set(currentIndex, prev);
      return nm;
    });
  };

  const handleRedo = () => {
    const undo = undoStackRef.current.get(currentIndex) || [];
    const redo = redoStackRef.current.get(currentIndex) || [];
    const current = cropByIndex.get(currentIndex);
    if (!current || redo.length === 0) return;
    const next = redo[redo.length - 1];
    redoStackRef.current.set(currentIndex, redo.slice(0, -1));
    undoStackRef.current.set(currentIndex, [...undo, current]);
    setCropByIndex((m) => {
      const nm = new Map(m);
      nm.set(currentIndex, next);
      return nm;
    });
  };

  const resizeAndCompressImage = useCallback(
    (
      sourceCanvas: HTMLCanvasElement,
      maxDimension: number = 3000,
      maxSizeBytes: number = 20 * 1024 * 1024,
      initialQuality: number = 0.92,
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
          resizedCanvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Failed to create blob'));
                return;
              }
              if (blob.size > maxSizeBytes && quality > 0.75) {
                tryCompress(Math.max(0.75, quality - 0.05));
              } else {
                resolve(blob);
              }
            },
            'image/jpeg',
            quality,
          );
        };

        tryCompress(initialQuality);
      });
    },
    [],
  );

  const createCroppedImage = useCallback(
    async (percentCrop: PercentCrop, sourceFile: File): Promise<Blob> => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');

      // Decode ORIGINAL file at full resolution only when saving (not during browsing).
      const bitmap = await createImageBitmap(sourceFile);
      const origW = bitmap.width;
      const origH = bitmap.height;

      const sx = Math.max(0, Math.round((percentCrop.x / 100) * origW));
      const sy = Math.max(0, Math.round((percentCrop.y / 100) * origH));
      const sw = Math.max(1, Math.round((percentCrop.width / 100) * origW));
      const sh = Math.max(1, Math.round((percentCrop.height / 100) * origH));

      canvas.width = sw;
      canvas.height = sh;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      bitmap.close();

      // Content heuristic: barcodes usually contain dark pixels
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let nonWhite = 0;
      let dark = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        const a = imageData.data[i + 3];
        if (a > 10 && (r < 245 || g < 245 || b < 245)) nonWhite++;
        if (a > 10 && (r < 150 || g < 150 || b < 150)) dark++;
      }
      const total = imageData.data.length / 4;
      const contentPct = (nonWhite / total) * 100;
      const darkPct = (dark / total) * 100;
      if (darkPct < 0.5 && contentPct < 1) {
        throw new Error(
          'Cropped area looks empty/white. Please drag the crop over the barcode (dark lines).',
        );
      }

      const compressed = await resizeAndCompressImage(canvas, 3000, 20 * 1024 * 1024, 0.95);
      if (compressed.size < 2000) {
        throw new Error(`Cropped image is too small (${(compressed.size / 1024).toFixed(2)}KB).`);
      }
      return compressed;
    },
    [resizeAndCompressImage],
  );

  const handleSaveSelection = useCallback(async () => {
    if (!imgRef.current) {
      toast.error('Image not ready yet');
      return;
    }
    if (!currentPercentCrop || currentPercentCrop.width < 0.1 || currentPercentCrop.height < 0.1) {
      toast.error('Drag to select a crop area first');
      return;
    }
    if (isCompleted) return;

    try {
      setUploadingIndices((prev) => new Set(prev).add(currentIndex));
      const blob = await createCroppedImage(currentPercentCrop, items[currentIndex]);
      await uploadOneWithCrop(items[currentIndex], blob);

      setCompletedIndices((prev) => {
        const next = new Set(prev);
        next.add(currentIndex);
        return next;
      });

      toast.success(`Saved & started processing image ${currentIndex + 1}`);

      // Auto-advance to next unsaved image
      const nextIdx = items.findIndex((_, idx) => !completedIndices.has(idx) && idx !== currentIndex);
      if (nextIdx !== -1) setCurrentIndex(nextIdx);
    } catch (e: any) {
      console.error('[BarcodeCropSlider] Save selection error:', e);
      toast.error(e?.message || 'Failed to save crop');
    } finally {
      setUploadingIndices((prev) => {
        const next = new Set(prev);
        next.delete(currentIndex);
        return next;
      });
    }
  }, [
    completedIndices,
    createCroppedImage,
    currentIndex,
    currentPixelCrop,
    currentPercentCrop,
    files,
    items,
    isCompleted,
    uploadOneWithCrop,
  ]);

  const handleRemove = useCallback(
    (idx: number) => {
      setItems((prev) => {
        if (prev.length <= 1) return prev; // keep at least one item to avoid empty cropper UX
        const next = prev.filter((_, i) => i !== idx);
        return next;
      });

      // Re-map per-index state so crops follow the correct images after deletion.
      const remap = <T,>(m: Map<number, T>) => {
        const out = new Map<number, T>();
        m.forEach((val, key) => {
          if (key === idx) return;
          out.set(key > idx ? key - 1 : key, val);
        });
        return out;
      };

      setCropByIndex((m) => remap(m));
      setPixelCropByIndex((m) => remap(m));
      setPercentCropByIndex((m) => remap(m));
      setThumbUrls((m) => {
        const out = new Map<number, string>();
        m.forEach((val, key) => {
          if (key === idx) {
            try {
              URL.revokeObjectURL(val);
            } catch {}
            return;
          }
          out.set(key > idx ? key - 1 : key, val);
        });
        return out;
      });
      // keep caches consistent
      const remapUrlCache = (cache: Map<number, string>) => {
        const out = new Map<number, string>();
        cache.forEach((val, key) => {
          if (key === idx) {
            try {
              URL.revokeObjectURL(val);
            } catch {}
            return;
          }
          out.set(key > idx ? key - 1 : key, val);
        });
        return out;
      };
      thumbCacheRef.current = remapUrlCache(thumbCacheRef.current);
      centerCacheRef.current = remapUrlCache(centerCacheRef.current);
      setCompletedIndices((s) => {
        const out = new Set<number>();
        s.forEach((k) => {
          if (k === idx) return;
          out.add(k > idx ? k - 1 : k);
        });
        return out;
      });
      setUploadingIndices((s) => {
        const out = new Set<number>();
        s.forEach((k) => {
          if (k === idx) return;
          out.add(k > idx ? k - 1 : k);
        });
        return out;
      });

      // remap undo/redo stacks
      const remapStacks = (ref: React.MutableRefObject<Map<number, Crop[]>>) => {
        const out = new Map<number, Crop[]>();
        ref.current.forEach((val, key) => {
          if (key === idx) return;
          out.set(key > idx ? key - 1 : key, val);
        });
        ref.current = out;
      };
      remapStacks(undoStackRef);
      remapStacks(redoStackRef);

      setCurrentIndex((cur) => {
        if (cur === idx) return Math.max(0, cur - 1);
        if (cur > idx) return cur - 1;
        return cur;
      });

      toast.info(`Removed image ${idx + 1} from batch`);
    },
    [redoStackRef, undoStackRef],
  );

  const handleSaveAll = useCallback(async () => {
    // Save with limited parallelism (faster enqueue, still safe for the browser)
    const indices = items
      .map((_, idx) => idx)
      .filter((idx) => !completedIndices.has(idx));

    if (indices.length === 0) {
      toast.info('All images already saved');
      return;
    }

    const missing = indices.find((idx) => !percentCropByIndex.get(idx));
    if (missing !== undefined) {
      toast.error(`Missing crop for image ${missing + 1}`);
      return;
    }

    const concurrency = 3;
    let cursor = 0;

    const runOne = async () => {
      while (cursor < indices.length) {
        const idx = indices[cursor++];
        const pc = percentCropByIndex.get(idx)!;

        try {
          setUploadingIndices((prev) => new Set(prev).add(idx));
          const blob = await createCroppedImage(pc, items[idx]);
          await uploadOneWithCrop(items[idx], blob);
          setCompletedIndices((prev) => {
            const next = new Set(prev);
            next.add(idx);
            return next;
          });
        } finally {
          setUploadingIndices((prev) => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, indices.length) }, runOne));
      toast.success('All images saved & queued for processing');
    } catch (e: any) {
      console.error('[BarcodeCropSlider] Save all error:', e);
      toast.error(e?.message || 'Failed to save all images');
    }
  }, [completedIndices, createCroppedImage, items, percentCropByIndex, uploadOneWithCrop]);

  const previewModalContent = (
    <AnimatePresence>
      {showPreview && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center bg-black/95 backdrop-blur-md z-[999999]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPreview(false);
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-3xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Card className="glass border-white/20">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <CardTitle className="flex items-center gap-3">
                  <Eye className="h-5 w-5 text-neon-cyan" />
                  <span>Info</span>
                </CardTitle>
                <button
                  onClick={() => setShowPreview(false)}
                  className="rounded-full p-2 hover:bg-white/10 transition-colors"
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
              <CardContent className="p-6 space-y-4">
                <div className="rounded-lg bg-white/5 border border-white/10 px-4 py-4 text-sm text-muted-foreground">
                  In the new flow, each “Save Selection” immediately uploads and enqueues <b>only that image</b> for background barcode processing.
                </div>
                <div className="flex items-center justify-end">
                  <Button variant="outline" onClick={() => setShowPreview(false)}>
                    Close
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const modalContent =
    items.length === 0 ? (
      <div className="fixed inset-0 flex items-center justify-center bg-red-900/90 z-[99999]">
        <div className="text-white p-8 bg-red-800 rounded-lg">
          <p className="text-xl font-bold">ERROR: No files provided to crop slider!</p>
        </div>
      </div>
    ) : (
      <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[99999]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="relative w-full h-full flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <Card className="glass border-white/20 flex flex-col w-full h-full overflow-hidden rounded-none sm:rounded-none">
            {/* Top toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/30">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <CropIcon className="h-5 w-5 text-neon-cyan" />
                  <span className="font-semibold tracking-wide">IMAGE BATCH CROPPER</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {currentIndex + 1}/{items.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant={canDownloadProcessedZip ? 'secondary' : 'outline'}
                  onClick={handleDownloadProcessedZip}
                  disabled={!canDownloadProcessedZip || isDownloadingZip}
                  className="h-9"
                  title={
                    canDownloadProcessedZip
                      ? 'Download processed images ZIP'
                      : 'Enabled once at least one image is processed'
                  }
                >
                  {isDownloadingZip ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Preparing ZIP...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Download ZIP
                    </>
                  )}
                </Button>

                <Button
                  variant={canDownloadFailedZip ? 'secondary' : 'outline'}
                  onClick={handleDownloadFailedZip}
                  disabled={!canDownloadFailedZip || isDownloadingFailedZip}
                  className="h-9"
                  title={
                    canDownloadFailedZip
                      ? 'Download failed images ZIP'
                      : 'Enabled once at least one image fails'
                  }
                >
                  {isDownloadingFailedZip ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Preparing failed ZIP...
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      Failed ZIP
                    </>
                  )}
                </Button>

                <Button
                  variant="neon"
                  onClick={handleSaveSelection}
                  disabled={isCompleted || isUploading || !currentPixelCrop}
                  className="h-9"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Selection
                    </>
                  )}
                </Button>

                <Button
                  variant={allCompleted ? 'secondary' : 'outline'}
                  onClick={handleSaveAll}
                  disabled={items.length === 0 || allCompleted}
                  className="h-9"
                  title="Save all remaining images"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save All
                </Button>

                <Button variant="outline" onClick={handleUndo} disabled={!canUndo} className="h-9">
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={handleRedo} disabled={!canRedo} className="h-9">
                  <Redo2 className="h-4 w-4" />
                </Button>

                {/* Zoom controls */}
                <div className="hidden md:flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1">
                  <Button
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setZoom((z) => clampZoom(z - 0.25))}
                    title="Zoom out"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={0.05}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="w-28"
                    aria-label="Zoom"
                  />
                  <span className="w-14 text-right text-xs font-mono text-muted-foreground">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setZoom((z) => clampZoom(z + 0.25))}
                    title="Zoom in"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>

                <div className="hidden sm:flex items-center gap-2">
                  <Button
                    variant={aspectMode === 'free' ? 'neon' : 'outline'}
                    onClick={() => setAspectMode('free')}
                    className="h-9 px-3"
                  >
                    Free
                  </Button>
                  <Button
                    variant={aspectMode === '3:2' ? 'neon' : 'outline'}
                    onClick={() => setAspectMode('3:2')}
                    className="h-9 px-3"
                  >
                    3:2
                  </Button>
                  <Button
                    variant={aspectMode === '16:9' ? 'neon' : 'outline'}
                    onClick={() => setAspectMode('16:9')}
                    className="h-9 px-3"
                  >
                    16:9
                  </Button>
                  <Button
                    variant={aspectMode === '1:1' ? 'neon' : 'outline'}
                    onClick={() => setAspectMode('1:1')}
                    className="h-9 px-3"
                  >
                    1:1
                  </Button>
                </div>

                <Button variant="outline" onClick={() => setShowPreview(true)} className="h-9">
                  <Eye className="h-4 w-4" />
                </Button>

                <button
                  onClick={onCancel}
                  className="ml-1 rounded-full p-2 hover:bg-white/10 transition-colors"
                  title="Close"
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Center stage */}
            <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
              <div className="relative flex-1 min-h-0 bg-black/40">
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 text-xs text-muted-foreground bg-black/50 border border-white/10 rounded-full px-3 py-1">
                  CROP AREA:{' '}
                  <span className="font-mono text-foreground">
                    {currentPixelCrop
                      ? `${Math.round(currentPixelCrop.width)}px × ${Math.round(currentPixelCrop.height)}px`
                      : '—'}
                  </span>
                </div>

                {(progress?.totalImages ?? 0) > 0 && (
                  <div className="absolute top-3 right-3 z-20 rounded-lg bg-black/50 border border-white/10 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Processing</div>
                    <div className="text-sm font-mono text-neon-cyan">
                      {progress?.progressPercentage ?? 0}%
                    </div>
                  </div>
                )}

                {!currentImageUrl ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-neon-cyan mx-auto mb-2" />
                      <p className="text-muted-foreground">
                        Loading image {currentIndex + 1} of {items.length}...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
                    <div className="relative w-full h-full min-h-[520px] max-w-none rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                      {/* Skeleton overlay while the center image decodes */}
                      {!isLoaded(currentIndex) && (
                        <div className="absolute inset-0 z-20 bg-gradient-to-br from-white/5 to-transparent animate-pulse" />
                      )}
                      <div
                        className="absolute inset-0 overflow-auto"
                        onWheel={(e) => {
                          // Hold Ctrl (or trackpad pinch-zoom) to zoom; otherwise allow normal scroll/pan
                          if (!e.ctrlKey) return;
                          e.preventDefault();
                          const delta = e.deltaY > 0 ? -0.1 : 0.1;
                          setZoom((z) => clampZoom(z + delta));
                        }}
                      >
                        <ReactCrop
                          crop={currentCrop}
                          onChange={(next) => {
                            setCropByIndex((m) => {
                              const nm = new Map(m);
                              nm.set(currentIndex, next);
                              return nm;
                            });
                          }}
                        onComplete={(pixelCrop, percentCrop) => {
                            // Commit to undo history only at interaction end, not on every mouse move
                            commitCropForUndo(currentIndex, cropByIndex.get(currentIndex));
                            setPixelCropByIndex((m) => {
                              const nm = new Map(m);
                              nm.set(currentIndex, pixelCrop);
                              return nm;
                            });
                          setPercentCropByIndex((m) => {
                            const nm = new Map(m);
                            nm.set(currentIndex, percentCrop);
                            return nm;
                          });
                          }}
                          aspect={aspect}
                          className="min-w-full min-h-full"
                        >
                          <img
                            ref={(el) => {
                              imgRef.current = el;
                              if (imgRef.current) imgRef.current.draggable = false;
                            }}
                            src={currentImageUrl}
                            alt={`Image ${currentIndex + 1}`}
                            decoding="async"
                            className="block select-none max-w-none max-h-none"
                            style={{
                              width: `${zoom * 100}%`,
                              height: `${zoom * 100}%`,
                              objectFit: 'contain',
                            }}
                            onLoad={(e) => {
                              const image = e.currentTarget;
                              markLoaded(currentIndex);
                              if (!aspect) return;
                              if (cropByIndex.has(currentIndex)) return;
                              const w = image.width;
                              const h = image.height;
                              const initial = centerCrop(
                                makeAspectCrop({ unit: '%', width: 70 }, aspect, w, h),
                                w,
                                h,
                              );
                              setCropByIndex((m) => {
                                const nm = new Map(m);
                                nm.set(currentIndex, initial);
                                return nm;
                              });
                            }}
                          />
                        </ReactCrop>
                      </div>

                      <div className="absolute bottom-3 left-3 text-xs text-muted-foreground bg-black/50 border border-white/10 rounded-lg px-3 py-2">
                        Drag to draw a crop. Resize with handles. Use <span className="text-foreground">Zoom</span> for precision.
                      </div>

                      {isCompleted && (
                        <div className="absolute bottom-3 right-3 text-xs bg-neon-cyan/15 border border-neon-cyan/30 text-neon-cyan rounded-lg px-3 py-2">
                          ⏳ Queued
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom drawer */}
              <div className="flex-shrink-0 border-t border-white/10 bg-black/40 px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-muted-foreground">
                    {completedIndices.size}/{items.length} saved
                  </div>
                  {allCompleted && (
                    <span className="text-xs text-neon-green font-medium">✓ All images saved</span>
                  )}
                </div>

                <div className="flex gap-3 overflow-x-auto pb-1">
                  {items.map((file, idx) => {
                    const url = thumbUrls.get(idx);
                    const isActive = idx === currentIndex;
                    const done = completedIndices.has(idx);
                    const uploading = uploadingIndices.has(idx);
                    return (
                      <Thumbnail
                        key={url || idx}
                        idx={idx}
                        file={file}
                        url={url}
                        isActive={isActive}
                        done={done}
                        uploading={uploading}
                        onSelect={setCurrentIndex}
                        onRemove={handleRemove}
                      />
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );

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



import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowDownRight, Scan } from 'lucide-react';
import { UploadPanel } from '../../components/UploadPanel';
import { ProgressDashboard } from '../../components/ProgressDashboard';
import { JobMetrics } from '../../components/JobMetrics';
import { DownloadSection } from '../../components/DownloadSection';
import { Loader } from '../../components/Loader';
import { useProgress } from '../../hooks/useProgress';
import { downloadZip } from '../../services/api';

/**
 * Dashboard Page
 *
 * Main application page containing all four sections:
 * 1. Upload Panel
 * 2. Processing Progress
 * 3. Job Metrics
 * 4. Download ZIP
 *
 * Features live polling via React Query (every 2 seconds).
 */
export function Dashboard() {
  const { data: progress, isLoading, isError } = useProgress(true);
  const downloadsRef = useRef<HTMLDivElement | null>(null);
  const lastAutoDownloadedBatchRef = useRef<string>('');

  // Track previous state for toast notifications
  const prevProgress = useRef(progress);

  useEffect(() => {
    const prev = prevProgress.current;
    const curr = progress;

    if (!prev || !curr) {
      prevProgress.current = curr;
      return;
    }

    // Notify when processing starts
    if (prev.totalImages === 0 && curr.totalImages > 0) {
      toast.info('Processing started', {
        description: `${curr.totalImages} images queued`,
      });
    }

    // Notify when processing completes
    if (
      prev.progressPercentage < 100 &&
      curr.progressPercentage === 100 &&
      curr.totalImages > 0
    ) {
      toast.dismiss(); // close any previous toasts so completion feels clean
      toast.success('Processing completed!', {
        description: `${curr.processedImages} processed, ${curr.failedImages} failed`,
      });

      // Auto-download processed ZIP once per batch (can be disabled later via a UI toggle)
      const batchKey = `${curr.totalImages}:${curr.processedImages}:${curr.failedImages}`;
      if (lastAutoDownloadedBatchRef.current !== batchKey) {
        lastAutoDownloadedBatchRef.current = batchKey;
        setTimeout(() => {
          // Auto-download is best-effort; fail silently to avoid noisy UX.
          downloadZip().catch(() => {});
        }, 400);
      }
    }

    // Notify on new failures
    if (curr.failedImages > prev.failedImages) {
      const newFailures = curr.failedImages - prev.failedImages;
      toast.error(`${newFailures} image(s) failed barcode detection`);
    }

    prevProgress.current = curr;
  }, [progress]);

  const isComplete =
    (progress?.progressPercentage ?? 0) === 100 && (progress?.totalImages ?? 0) > 0;

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* ── Background effects ──────────────────────────────────────────── */}
      <div className="fixed inset-0 -z-10">
        {/* Gradient orbs */}
        <div className="absolute top-1/4 -left-1/4 h-96 w-96 rounded-full bg-neon-cyan/5 blur-3xl" />
        <div className="absolute bottom-1/4 -right-1/4 h-96 w-96 rounded-full bg-neon-purple/5 blur-3xl" />
        <div className="absolute top-3/4 left-1/2 h-64 w-64 rounded-full bg-neon-pink/5 blur-3xl" />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Completion CTA */}
        {isComplete && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 rounded-xl border border-neon-cyan/30 bg-neon-cyan/10 px-5 py-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ y: [0, 3, 0] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                >
                  <ArrowDownRight className="h-5 w-5 text-neon-cyan" />
                </motion.div>
                <div>
                  <p className="text-sm font-medium text-neon-cyan">
                    Processing complete — go to Downloads
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Download processed/original/failed ZIPs below.
                  </p>
                </div>
              </div>
              <button
                className="rounded-lg bg-black/30 px-4 py-2 text-sm text-foreground border border-white/10 hover:border-neon-cyan/40 transition-colors"
                onClick={() => downloadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Go to Downloads
              </button>
            </div>
          </motion.div>
        )}
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-neon-cyan to-neon-purple shadow-lg neon-glow-cyan">
              <Scan className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                <span className="gradient-text">Barocode</span>
              </h1>
              <p className="text-sm text-muted-foreground">
                High-performance barcode image processing system
              </p>
            </div>
          </div>

          {/* Decorative line */}
          <div className="mt-6 h-px bg-gradient-to-r from-transparent via-neon-cyan/30 to-transparent" />
        </motion.header>

        {/* Error state */}
        {isError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 rounded-xl bg-destructive/10 border border-destructive/20 px-6 py-4 text-destructive"
          >
            ⚠ Unable to connect to the server. Make sure the backend is running on port 3001.
          </motion.div>
        )}

        {/* Loading state */}
        {isLoading && !progress && (
          <div className="flex justify-center py-20">
            <Loader text="Connecting to server..." size="lg" />
          </div>
        )}

        {/* Dashboard grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 gap-6 lg:grid-cols-2"
        >
          {/* Left column: Upload + Download */}
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <UploadPanel />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div ref={downloadsRef}>
                <DownloadSection progress={progress} />
              </div>
            </motion.div>
          </div>

          {/* Right column: Progress + Metrics */}
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <ProgressDashboard progress={progress} isLoading={isLoading} />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
            >
              <JobMetrics progress={progress} />
            </motion.div>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 text-center"
        >
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mb-6" />
          <p className="text-xs text-muted-foreground">
            Barocode — Built for processing up to 1,000,000 images
          </p>
        </motion.footer>
      </div>
    </div>
  );
}


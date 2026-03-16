import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Archive, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { downloadZip, type JobProgress } from '../services/api';

interface DownloadSectionProps {
  progress: JobProgress | undefined;
}

/**
 * Download Section Component
 *
 * Provides a ZIP download button for processed images.
 * Only enabled when processing is complete (or has processed files).
 */
export function DownloadSection({ progress }: DownloadSectionProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadComplete, setDownloadComplete] = useState(false);

  const hasProcessedImages = (progress?.processedImages ?? 0) > 0;
  const isComplete = progress?.progressPercentage === 100 && (progress?.totalImages ?? 0) > 0;
  const canDownload = hasProcessedImages && !isDownloading;

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      setDownloadComplete(false);
      toast.info('Preparing ZIP download...');

      await downloadZip();

      setDownloadComplete(true);
      toast.success('Download ready!');
    } catch (error) {
      toast.error('Failed to download ZIP. Please try again.');
      console.error('Download error:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card className="glass border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg">
          <div className={`
            flex h-10 w-10 items-center justify-center rounded-lg
            ${isComplete
              ? 'bg-neon-green/20 neon-glow-green'
              : 'bg-gradient-to-br from-neon-blue/20 to-neon-cyan/20'
            }
          `}>
            <Archive className={`h-5 w-5 ${isComplete ? 'text-neon-green' : 'text-neon-blue'}`} />
          </div>
          <span>Download</span>

          {isComplete && (
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              className="ml-auto"
            >
              <CheckCircle2 className="h-5 w-5 text-neon-green" />
            </motion.div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status message */}
        <div className="rounded-lg bg-white/5 px-4 py-3">
          <AnimatePresence mode="wait">
            {isComplete ? (
              <motion.div
                key="complete"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4 text-neon-green" />
                <span className="text-sm text-neon-green font-medium">
                  All images processed! Ready for download.
                </span>
              </motion.div>
            ) : hasProcessedImages ? (
              <motion.div
                key="partial"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <Archive className="h-4 w-4 text-neon-cyan" />
                <span className="text-sm text-muted-foreground">
                  {progress?.processedImages} images processed so far.
                  You can download now or wait for completion.
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="waiting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Processed images will be available for download as a ZIP file.
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Download button */}
        <Button
          variant={isComplete ? 'neon' : 'secondary'}
          size="lg"
          className="w-full"
          onClick={handleDownload}
          disabled={!canDownload}
        >
          {isDownloading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Preparing ZIP...
            </>
          ) : downloadComplete ? (
            <>
              <CheckCircle2 className="mr-2 h-5 w-5" />
              Downloaded!
            </>
          ) : (
            <>
              <Download className="mr-2 h-5 w-5" />
              Download Processed Images (ZIP)
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}


import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Progress } from './ui/progress';
import { type JobProgress } from '../services/api';

interface ProgressDashboardProps {
  progress: JobProgress | undefined;
  isLoading: boolean;
}

/**
 * Progress Dashboard Component
 *
 * Animated progress bar showing overall processing completion.
 * Uses Framer Motion for smooth animations on value changes.
 */
export function ProgressDashboard({ progress, isLoading }: ProgressDashboardProps) {
  const percentage = progress?.progressPercentage ?? 0;
  const isComplete = percentage === 100 && (progress?.totalImages ?? 0) > 0;
  const isProcessing = (progress?.totalImages ?? 0) > 0 && percentage < 100;

  return (
    <Card className="glass border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg">
          <div className={`
            flex h-10 w-10 items-center justify-center rounded-lg
            ${isComplete
              ? 'bg-neon-green/20 neon-glow-green'
              : 'bg-gradient-to-br from-neon-purple/20 to-neon-pink/20 neon-glow-purple'
            }
          `}>
            <Activity className={`h-5 w-5 ${isComplete ? 'text-neon-green' : 'text-neon-purple'}`} />
          </div>
          <span>Processing Progress</span>

          {isProcessing && (
            <motion.span
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="ml-auto text-xs font-normal text-neon-cyan"
            >
              ● LIVE
            </motion.span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main progress bar */}
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <motion.span
                key={percentage}
                initial={{ scale: 1.2, color: '#00f0ff' }}
                animate={{ scale: 1, color: isComplete ? '#30d158' : '#ffffff' }}
                className="text-4xl font-bold font-mono"
              >
                {percentage}
              </motion.span>
              <span className="text-2xl font-bold text-muted-foreground">%</span>
            </div>

            {isComplete && (
              <motion.span
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-sm font-medium text-neon-green"
              >
                ✓ Complete
              </motion.span>
            )}
          </div>

          {/* Animated progress bar */}
          <div className="relative">
            <Progress value={percentage} className="h-4" />

            {/* Shimmer effect when processing */}
            {isProcessing && (
              <div className="absolute inset-0 overflow-hidden rounded-full">
                <motion.div
                  className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ x: ['-100%', '400%'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Processing stats summary */}
        {(progress?.totalImages ?? 0) > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-2 gap-3 text-sm"
          >
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <span className="text-muted-foreground">Speed</span>
              <p className="font-mono font-medium text-foreground">
                {progress && progress.processedImages > 0
                  ? `~${Math.round(progress.processedImages / Math.max(1, (Date.now() % 100000) / 1000))} img/s`
                  : '—'
                }
              </p>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <span className="text-muted-foreground">Queue</span>
              <p className="font-mono font-medium text-foreground">
                {progress ? `${progress.pendingImages} pending` : '—'}
              </p>
            </div>
          </motion.div>
        )}

        {/* Empty state */}
        {(!progress || progress.totalImages === 0) && !isLoading && (
          <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
            <Activity className="mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">No images in the processing queue</p>
            <p className="text-xs mt-1">Upload images to start processing</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


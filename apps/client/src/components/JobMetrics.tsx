import { motion } from 'framer-motion';
import {
  ImageIcon,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { type JobProgress } from '../services/api';
import { formatNumber } from '../lib/utils';

interface JobMetricsProps {
  progress: JobProgress | undefined;
}

/** Metric card data definition */
interface MetricItem {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  glowClass: string;
  badgeVariant: 'info' | 'success' | 'destructive' | 'warning';
}

/**
 * Job Metrics Component
 *
 * Displays four key metrics: Total, Processed, Failed, Pending
 * Each metric has an animated counter and neon-styled icon.
 */
export function JobMetrics({ progress }: JobMetricsProps) {
  const metrics: MetricItem[] = [
    {
      label: 'Total Images',
      value: progress?.totalImages ?? 0,
      icon: <ImageIcon className="h-5 w-5 text-neon-cyan" />,
      color: 'text-neon-cyan',
      glowClass: 'neon-glow-cyan',
      badgeVariant: 'info',
    },
    {
      label: 'Processed',
      value: progress?.processedImages ?? 0,
      icon: <CheckCircle2 className="h-5 w-5 text-neon-green" />,
      color: 'text-neon-green',
      glowClass: 'neon-glow-green',
      badgeVariant: 'success',
    },
    {
      label: 'Failed',
      value: progress?.failedImages ?? 0,
      icon: <XCircle className="h-5 w-5 text-neon-pink" />,
      color: 'text-neon-pink',
      glowClass: 'neon-glow-pink',
      badgeVariant: 'destructive',
    },
    {
      label: 'Pending',
      value: progress?.pendingImages ?? 0,
      icon: <Clock className="h-5 w-5 text-neon-purple" />,
      color: 'text-neon-purple',
      glowClass: 'neon-glow-purple',
      badgeVariant: 'warning',
    },
  ];

  return (
    <Card className="glass border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan/20 to-neon-green/20 neon-glow-cyan">
            <ImageIcon className="h-5 w-5 text-neon-cyan" />
          </div>
          <span>Job Metrics</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {metrics.map((metric, index) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="group relative overflow-hidden rounded-xl bg-white/5 p-4 transition-all duration-300 hover:bg-white/10"
            >
              {/* Background glow effect */}
              <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${metric.glowClass}`} />

              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5">
                    {metric.icon}
                  </div>
                  <Badge variant={metric.badgeVariant} className="text-[10px]">
                    {metric.label}
                  </Badge>
                </div>

                <motion.p
                  key={metric.value}
                  initial={{ scale: 1.1 }}
                  animate={{ scale: 1 }}
                  className={`text-2xl font-bold font-mono ${metric.color}`}
                >
                  {formatNumber(metric.value)}
                </motion.p>

                <p className="mt-1 text-xs text-muted-foreground">
                  {metric.label.toLowerCase()}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}


import { motion } from 'framer-motion';

interface LoaderProps {
  /** Text to display below the spinner */
  text?: string;
  /** Size of the loader */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Loader Component
 *
 * Futuristic animated loading spinner with neon gradient.
 * Used when uploading, processing queue, or preparing ZIP.
 */
export function Loader({ text, size = 'md' }: LoaderProps) {
  const sizeMap = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
    lg: 'h-16 w-16',
  };

  const borderMap = {
    sm: 'border-2',
    md: 'border-3',
    lg: 'border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      {/* Spinning rings */}
      <div className="relative">
        {/* Outer ring */}
        <motion.div
          className={`${sizeMap[size]} rounded-full ${borderMap[size]} border-transparent border-t-neon-cyan border-r-neon-purple`}
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />

        {/* Inner ring */}
        <motion.div
          className={`absolute inset-1 rounded-full ${borderMap[size]} border-transparent border-b-neon-pink border-l-neon-green`}
          animate={{ rotate: -360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        />

        {/* Center dot */}
        <motion.div
          className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-neon-cyan"
          animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      </div>

      {/* Loading text */}
      {text && (
        <motion.p
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-sm text-muted-foreground"
        >
          {text}
        </motion.p>
      )}
    </div>
  );
}


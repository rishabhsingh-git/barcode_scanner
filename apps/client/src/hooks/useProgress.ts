import { useQuery } from '@tanstack/react-query';
import { fetchProgress, type JobProgress } from '../services/api';

/**
 * useProgress Hook
 *
 * Polls the backend every 2 seconds for processing progress.
 * Uses React Query for automatic caching, refetching, and error handling.
 *
 * @param enabled - Whether to enable polling (disabled when no jobs exist)
 */
export function useProgress(enabled: boolean = true) {
  return useQuery<JobProgress>({
    queryKey: ['jobProgress'],
    queryFn: fetchProgress,
    refetchInterval: enabled ? 2000 : false, // Poll every 2 seconds
    refetchIntervalInBackground: false,       // Don't poll when tab is hidden
    staleTime: 1000,                           // Data is fresh for 1 second
    retry: 2,
  });
}


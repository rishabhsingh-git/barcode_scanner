import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { Dashboard } from './pages/dashboard/Dashboard';

// Create a stable React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

/**
 * App Root
 *
 * Sets up React Query provider and Sonner toast notifications.
 * Renders the main Dashboard page.
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />

      {/* Global toast notifications (Sonner) */}
      <Toaster
        theme="dark"
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          style: {
            background: 'hsl(222, 47%, 8%)',
            border: '1px solid hsl(217, 33%, 17%)',
            color: 'hsl(210, 40%, 96%)',
          },
        }}
      />
    </QueryClientProvider>
  );
}

export default App;


'use client';

/**
 * App-wide TanStack Query provider. Wraps the tree so any client component can
 * use `useQuery` / `useMutation`. Devtools are mounted in development only.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { getQueryClient } from '@/lib/queryClient';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // NOTE: no useState here — getQueryClient already returns a stable browser
  // singleton, and there's no suspense boundary above this provider.
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      )}
    </QueryClientProvider>
  );
}

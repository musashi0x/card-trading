/**
 * TanStack Query client factory.
 *
 * The app is client-driven (data comes from an external API at
 * `NEXT_PUBLIC_API_URL`), so we use the standard provider pattern: a fresh
 * client on the server and a browser-wide singleton on the client. The
 * singleton matters so React doesn't throw the client away if it suspends
 * during the initial render.
 */

import { QueryClient, isServer } from '@tanstack/react-query';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Avoid an immediate refetch on mount/hydration.
        staleTime: 30 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) {
    // Server: always a fresh client, never shared across requests.
    return makeQueryClient();
  }
  // Browser: reuse one client across renders.
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

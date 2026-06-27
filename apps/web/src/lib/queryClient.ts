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
        // `always` makes a failed fetch surface as an error instead of being
        // paused as "offline". We talk to a configurable external API origin and
        // want callers to fall back (e.g. demo cards) when it's unreachable —
        // the default 'online' mode would leave queries stuck in `paused`.
        networkMode: 'always',
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

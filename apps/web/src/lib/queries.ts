/**
 * TanStack Query hooks over the typed `api` client. Centralizing query keys in
 * `queryKeys` keeps reads and cache invalidations in sync — call
 * `queryClient.invalidateQueries({ queryKey: queryKeys.listings() })` after a
 * mutation to refetch the affected lists.
 */

import { useQuery } from '@tanstack/react-query';
import { api, type OrderWithCard } from '@/lib/api';

type ListingFilters = { q?: string; set?: string; rarity?: string };

export const queryKeys = {
  cards: (owner?: string) => ['cards', owner ?? 'all'] as const,
  listings: (filters?: ListingFilters) => ['listings', filters ?? {}] as const,
  offers: (listingId: string) => ['offers', listingId] as const,
  trades: () => ['trades'] as const,
  orders: (account: string) => ['orders', account] as const,
  disputedOrders: () => ['orders', 'disputed'] as const,
};

/** Open listings, optionally filtered by query/set/rarity. */
export function useListings(filters?: ListingFilters) {
  return useQuery({
    queryKey: queryKeys.listings(filters),
    queryFn: () => api.listings(filters),
  });
}

/**
 * Cards held by `owner` (used by the Sell picker). Disabled until a wallet is
 * connected, so passing `null`/`undefined` is safe.
 */
export function useCards(owner?: string | null) {
  return useQuery({
    queryKey: queryKeys.cards(owner ?? undefined),
    queryFn: () => api.cards(owner ?? undefined),
    enabled: !!owner,
  });
}

/** Offers on a single listing. */
export function useOffers(listingId: string | null) {
  return useQuery({
    queryKey: queryKeys.offers(listingId ?? ''),
    queryFn: () => api.offers(listingId as string),
    enabled: !!listingId,
  });
}

/** Recent settled trades. */
export function useTrades() {
  return useQuery({
    queryKey: queryKeys.trades(),
    queryFn: () => api.trades(),
  });
}

/** Escrow orders where `account` is buyer or seller. */
export function useOrders(account: string | null) {
  return useQuery({
    queryKey: queryKeys.orders(account ?? ''),
    queryFn: () => api.orders(account as string),
    enabled: !!account,
  });
}

/** Open disputes awaiting arbiter resolution. */
export function useDisputedOrders(enabled = true) {
  return useQuery<OrderWithCard[]>({
    queryKey: queryKeys.disputedOrders(),
    queryFn: () => api.disputedOrders().catch(() => [] as OrderWithCard[]),
    enabled,
  });
}

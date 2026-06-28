/**
 * TanStack Query hooks over the typed `api` client. Centralizing query keys in
 * `queryKeys` keeps reads and cache invalidations in sync — call
 * `queryClient.invalidateQueries({ queryKey: queryKeys.listings() })` after a
 * mutation to refetch the affected lists.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CardComment, CardReview, CardReviewBody, LeaderboardBoard, TradeProposalStatus, WatchlistEntry } from '@cardmkt/shared';
import { api, type OrderWithCard } from '@/lib/api';

type ListingFilters = { q?: string; set?: string; rarity?: string };

export const queryKeys = {
  cardReviews: (cardId: string) => ['cardReviews', cardId] as const,
  cardReviewEligibility: (cardId: string, address: string) =>
    ['cardReviews', cardId, 'eligibility', address] as const,
  cardComments: (cardId: string) => ['cardComments', cardId] as const,
  cards: (owner?: string) => ['cards', owner ?? 'all'] as const,
  listings: (filters?: ListingFilters) => ['listings', filters ?? {}] as const,
  offers: (listingId: string) => ['offers', listingId] as const,
  auctions: () => ['auctions'] as const,
  auctionBids: (auctionId: string) => ['auctions', auctionId, 'bids'] as const,
  myBids: (bidder: string) => ['my-bids', bidder] as const,
  trades: (account?: string) => ['trades', account ?? 'all'] as const,
  tradeProposals: (party: string, status?: TradeProposalStatus) =>
    ['tradeProposals', party, status ?? 'all'] as const,
  orders: (account: string) => ['orders', account] as const,
  disputedOrders: () => ['orders', 'disputed'] as const,
  watchlist: (account: string) => ['watchlist', account] as const,
  profile: (address: string) => ['profile', address] as const,
  profileStats: (address: string) => ['profile', address, 'stats'] as const,
  profileReviews: (address: string) => ['profile', address, 'reviews'] as const,
  portfolio: (account: string) => ['portfolio', account] as const,
  leaderboard: (board: LeaderboardBoard, account?: string) =>
    ['leaderboard', board, account ?? 'anon'] as const,
};

/**
 * Invalidate the escrow-order reads so they refetch. Call from a mutation's
 * `onSuccess` after any action that changes order state (purchase, confirm,
 * ship, dispute, arbiter resolution).
 */
export function invalidateOrders(queryClient: QueryClient, account: string | null) {
  if (account) queryClient.invalidateQueries({ queryKey: queryKeys.orders(account) });
  queryClient.invalidateQueries({ queryKey: queryKeys.disputedOrders() });
}

/** Open listings, optionally filtered by query/set/rarity. */
export function useListings(filters?: ListingFilters) {
  return useQuery({
    queryKey: queryKeys.listings(filters),
    queryFn: () => api.listings(filters),
    refetchInterval: 5000, // Refetch every 5 seconds
  });
}

/** Open timed auctions for the browse grid; polls so countdowns stay fresh. */
export function useAuctions() {
  return useQuery({
    queryKey: queryKeys.auctions(),
    queryFn: () => api.auctions('open'),
    refetchInterval: 5000,
  });
}

/** Bid history for a single auction, high bid first. Disabled without an id. */
export function useAuctionBids(auctionId: string | null) {
  return useQuery({
    queryKey: queryKeys.auctionBids(auctionId ?? ''),
    queryFn: () => api.auctionBids(auctionId as string).then((r) => r.bids),
    enabled: !!auctionId,
    refetchInterval: 5000,
  });
}

/** Every bid the connected wallet placed across auctions. Disabled until connected. */
export function useMyBids(bidder: string | null) {
  return useQuery({
    queryKey: queryKeys.myBids(bidder ?? ''),
    queryFn: () => api.myBids(bidder as string),
    enabled: !!bidder,
    refetchInterval: 5000,
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

/** Recent settled trades; with `account`, only trades where the wallet took part. */
export function useTrades(account?: string | null) {
  return useQuery({
    queryKey: queryKeys.trades(account ?? undefined),
    queryFn: () => api.trades(account ?? undefined),
  });
}

/**
 * Barter proposals where `party` is proposer or counterparty. Polls so the
 * inbox reflects an accepted/declined/cancelled proposal shortly after it
 * settles. Disabled until a wallet connects.
 */
export function useTradeProposals(party: string | null, status?: TradeProposalStatus) {
  return useQuery({
    queryKey: queryKeys.tradeProposals(party ?? '', status),
    queryFn: () => api.tradeProposals(party as string, status),
    enabled: !!party,
    refetchInterval: 8000,
  });
}

/** Invalidate the barter-proposal reads so the inbox refetches after an action. */
export function invalidateTradeProposals(queryClient: QueryClient, party: string | null) {
  if (party) queryClient.invalidateQueries({ queryKey: ['tradeProposals', party] });
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

/** A wallet's profile. Disabled until an address is available. */
export function useProfile(address: string | null) {
  return useQuery({
    queryKey: queryKeys.profile(address ?? ''),
    queryFn: () => api.profile(address as string),
    enabled: !!address,
  });
}

/** Derived profile stats + achievements for a wallet. */
export function useProfileStats(address: string | null) {
  return useQuery({
    queryKey: queryKeys.profileStats(address ?? ''),
    queryFn: () => api.profileStats(address as string),
    enabled: !!address,
  });
}

/** Reviews written about a wallet. */
export function useProfileReviews(address: string | null) {
  return useQuery({
    queryKey: queryKeys.profileReviews(address ?? ''),
    queryFn: () => api.profileReviews(address as string),
    enabled: !!address,
  });
}

/**
 * A ranked leaderboard board with the connected wallet's own standing. Refetches
 * automatically when `board` or `account` changes. `staleTime` matches the
 * server-side 5-minute cache so the UI doesn't re-request rows the API would
 * just serve from cache anyway.
 */
export function useLeaderboard(board: LeaderboardBoard, account: string | null) {
  return useQuery({
    queryKey: queryKeys.leaderboard(board, account ?? undefined),
    queryFn: () => api.leaderboard({ board, account: account ?? undefined }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The connected wallet's live portfolio (holdings, valuation, history). Disabled
 * until a wallet is connected, so passing `null`/`undefined` is safe.
 */
export function usePortfolio(account: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.portfolio(account ?? ''),
    queryFn: () => api.portfolio(account as string),
    enabled: !!account,
  });
}

/** Update the connected wallet's profile, refreshing the profile query on success. */
export function useUpdateProfile(address: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: import('@cardmkt/shared').ProfileUpdateBody) => api.updateProfile(address!, body),
    onSuccess: (updated) => {
      if (address) queryClient.setQueryData(queryKeys.profile(address), updated);
    },
  });
}

/** The connected wallet's watched open listings. Disabled until a wallet connects. */
export function useWatchlist(account: string | null) {
  return useQuery({
    queryKey: queryKeys.watchlist(account ?? ''),
    queryFn: () => api.watchlist(account as string),
    enabled: !!account,
  });
}

/** Reviews (list + aggregate) for a card. Always enabled — no wallet required. */
export function useCardReviews(cardId: string) {
  return useQuery({
    queryKey: queryKeys.cardReviews(cardId),
    queryFn: () => api.cardReviews(cardId),
    enabled: !!cardId,
  });
}

/** Whether the connected wallet may post a review for this card. */
export function useCardReviewEligibility(cardId: string, address: string | null) {
  return useQuery({
    queryKey: queryKeys.cardReviewEligibility(cardId, address ?? ''),
    queryFn: () => api.cardReviewEligibility(cardId, address as string),
    enabled: !!cardId && !!address,
  });
}

/** Submit or update a card review with optimistic update on success. */
export function useSubmitCardReview(cardId: string, address: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CardReviewBody) => api.submitCardReview(cardId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cardReviews(cardId) });
    },
  });
}

/** Delete a card review with cache invalidation. */
export function useDeleteCardReview(cardId: string, address: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => api.deleteCardReview(cardId, reviewId, address!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cardReviews(cardId) });
    },
  });
}

/** Public comments for a card (oldest first). Always enabled — no wallet required. */
export function useCardComments(cardId: string) {
  return useQuery({
    queryKey: queryKeys.cardComments(cardId),
    queryFn: () => api.cardComments(cardId),
    enabled: !!cardId,
  });
}

/** Post a comment with optimistic prepend. */
export function usePostCardComment(cardId: string, address: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.postCardComment(cardId, { authorAddress: address!, body }),
    onSuccess: (newComment) => {
      queryClient.setQueryData<CardComment[]>(
        queryKeys.cardComments(cardId),
        (old = []) => [...old, newComment],
      );
    },
  });
}

/** Soft-delete a comment with optimistic inline redaction. */
export function useDeleteCardComment(cardId: string, address: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.deleteCardComment(cardId, commentId, address!),
    onSuccess: (_data, commentId) => {
      queryClient.setQueryData<CardComment[]>(
        queryKeys.cardComments(cardId),
        (old = []) =>
          old.map((c) =>
            c.id === commentId
              ? { ...c, body: '[comment removed]', authorAddress: null, deletedAt: new Date().toISOString() }
              : c,
          ),
      );
    },
  });
}

/**
 * Toggle a listing on the connected wallet's watchlist with an optimistic flip.
 * On error the previous cache is restored; on settle the list is refetched so it
 * reconciles with the server (and gains full listing detail for added rows).
 */
export function useToggleWatch(account: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, watching }: { listingId: string; watching: boolean }) =>
      watching ? api.watchlistRemove(account!, listingId) : api.watchlistAdd(account!, listingId),
    onMutate: async ({ listingId, watching }) => {
      if (!account) return;
      const key = queryKeys.watchlist(account);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<WatchlistEntry[]>(key);
      queryClient.setQueryData<WatchlistEntry[]>(key, (old = []) =>
        watching
          ? old.filter((e) => e.id !== listingId)
          : [{ id: listingId } as WatchlistEntry, ...old],
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && ctx.key) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      if (account) queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(account) });
    },
  });
}

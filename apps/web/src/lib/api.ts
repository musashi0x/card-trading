/**
 * Typed client for the marketplace API.
 */

import type {
  Auction,
  AuctionListResponse,
  BidListResponse,
  BuildTxResponse,
  Card,
  CardCommentBody,
  CardComment,
  CardReview,
  CardReviewBody,
  CardReviewsResponse,
  Listing,
  MyBidsResponse,
  MintCardRequest,
  MintCardResponse,
  Offer,
  Order,
  PasskeyListRequest,
  PasskeyOrderInput,
  PasskeySubmitRequest,
  PathPaymentBuildRequest,
  PathQuoteRequest,
  PathQuoteResponse,
  PortfolioResponse,
  LeaderboardBoard,
  LeaderboardResponse,
  ProfileResponse,
  ProfileStatsResponse,
  ProfileUpdateBody,
  ReviewCreateBody,
  ReviewResponse,
  SubmitTxResponse,
  Trade,
  TradeAction,
  TradeProposal,
  TradeProposalStatus,
  WatchlistEntry,
} from '@cardmkt/shared';

/** An order joined with a thumbnail of its card, as the orders API returns it. */
export type OrderWithCard = Order & {
  card: { id: string; name: string; set: string; rarity: string; imageUrl: string };
};

/** A settled trade with the derived seller-net the trades API computes per row. */
export type TradeWithNet = Trade & { sellerNetUsdc: string };

/** Body for creating a barter trade proposal. */
export interface ProposeSwapBody {
  proposer: string;
  counterparty: string;
  giveCardIds: string[];
  getCardIds: string[];
  cashUsdc?: string;
}

/** A swap action the proposer/counterparty can take on a proposal. */
export type SwapAction = 'accept' | 'decline' | 'cancel';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error ?? 'Request failed', body.code ?? 'INTERNAL', body.details);
  }
  return body as T;
}

export const api = {
  /** The card registry, or — with `owner` — only the cards that wallet holds. */
  cards: (owner?: string) =>
    request<Card[]>(`/api/cards${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`),
  listings: (params?: { q?: string; set?: string; rarity?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<Listing[]>(`/api/listings${qs ? `?${qs}` : ''}`);
  },
  offers: (listingId: string) => request<Offer[]>(`/api/listings/${listingId}/offers`),

  /** Open auctions for the catalog (with joined card metadata). */
  auctions: (status: 'open' | 'settled' | 'cancelled' | 'no_winner' = 'open') =>
    request<AuctionListResponse>(`/api/auctions?status=${status}`).then((r) => r.auctions),
  /** A single auction's full state. */
  auction: (auctionId: string) => request<Auction>(`/api/auctions/${auctionId}`),
  /** Paginated bid history for an auction, high bid first. */
  auctionBids: (auctionId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<BidListResponse>(`/api/auctions/${auctionId}/bids${qs ? `?${qs}` : ''}`);
  },
  /** Every bid a wallet placed, joined with auction state, for the my-bids page. */
  myBids: (bidder: string) =>
    request<MyBidsResponse>(`/api/auctions/bids?bidder=${encodeURIComponent(bidder)}`).then(
      (r) => r.bids,
    ),
  /** Settled trades, or — with `account` — only those where the wallet is buyer or seller. */
  trades: (account?: string) =>
    request<TradeWithNet[]>(`/api/trades${account ? `?account=${encodeURIComponent(account)}` : ''}`),

  /** Barter proposals where `party` is proposer or counterparty (optional status filter). */
  tradeProposals: (party: string, status?: TradeProposalStatus) =>
    request<TradeProposal[]>(
      `/api/trade-proposals?party=${encodeURIComponent(party)}${status ? `&status=${status}` : ''}`,
    ),
  /** Build a `propose_swap` tx + record the proposal; returns the XDR to sign. */
  proposeSwapBuild: (body: ProposeSwapBody) =>
    request<{ proposalId: string; xdr: string; networkPassphrase: string }>('/api/trade-proposals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Submit the signed `propose_swap`; captures the on-chain proposal id. */
  proposeSwapSubmit: (proposalId: string, signedXdr: string) =>
    request<SubmitTxResponse & { contractSwapId: number }>('/api/trade-proposals', {
      method: 'POST',
      body: JSON.stringify({ proposalId, signedXdr }),
    }),
  /** Build an accept/decline/cancel tx for a proposal; returns the XDR to sign. */
  swapActionBuild: (id: string, action: SwapAction, account: string) =>
    request<BuildTxResponse>(`/api/trade-proposals/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ account }),
    }),
  /** Submit the signed accept/decline/cancel tx for a proposal. */
  swapActionSubmit: (id: string, action: SwapAction, account: string, signedXdr: string) =>
    request<SubmitTxResponse>(`/api/trade-proposals/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ account, signedXdr }),
    }),

  /** A ranked leaderboard board, with the requesting account's own standing. */
  leaderboard: (params: { board: LeaderboardBoard; account?: string; limit?: number }) => {
    const qs = new URLSearchParams({ board: params.board });
    if (params.account) qs.set('account', params.account);
    if (params.limit != null) qs.set('limit', String(params.limit));
    return request<LeaderboardResponse>(`/api/leaderboard?${qs.toString()}`);
  },

  /** Physical-escrow orders where `account` is buyer or seller. */
  orders: (account: string) =>
    request<OrderWithCard[]>(`/api/orders?account=${encodeURIComponent(account)}`),
  /** Open disputes awaiting arbiter resolution. */
  disputedOrders: () => request<OrderWithCard[]>('/api/orders/disputed'),
  /** Arbiter resolution of a disputed order (server-signed with the arbiter key). */
  resolveOrder: (orderId: string, refund: boolean) =>
    request<SubmitTxResponse>('/api/tx/resolve', {
      method: 'POST',
      body: JSON.stringify({ orderId, refund }),
    }),
  /** Relay a passkey-authorized escrow order action (gasless smart wallet). */
  passkeyOrder: (body: PasskeyOrderInput) =>
    request<SubmitTxResponse & { refId: string }>('/api/tx/passkey-order', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  build: (action: TradeAction, body: Record<string, unknown>) => {
    const path = action.replace('_', '-');
    return request<BuildTxResponse & { refId: string }>(`/api/tx/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  submit: (signedXdr: string, action: TradeAction, refId: string) =>
    request<SubmitTxResponse>('/api/tx/submit', {
      method: 'POST',
      body: JSON.stringify({ signedXdr, action, refId }),
    }),

  /** A wallet's profile (lazily created on first fetch). */
  profile: (address: string) => request<ProfileResponse>(`/api/profiles/${address}`),
  /** Update the editable profile fields for a wallet. */
  updateProfile: (address: string, body: ProfileUpdateBody) =>
    request<ProfileResponse>(`/api/profiles/${address}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  /** Derived profile stats + achievements for a wallet. */
  profileStats: (address: string) =>
    request<ProfileStatsResponse>(`/api/profiles/${address}/stats`),
  /** Reviews written about a wallet (newest first). */
  profileReviews: (address: string) =>
    request<ReviewResponse[]>(`/api/profiles/${address}/reviews`),
  /** Post a review of the wallet at `address` (the trade counterparty). */
  postReview: (address: string, body: ReviewCreateBody) =>
    request<ReviewResponse>(`/api/profiles/${address}/reviews`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** The connected wallet's live portfolio: holdings, valuation, history. */
  portfolio: (account: string) =>
    request<PortfolioResponse>(`/api/portfolio?account=${encodeURIComponent(account)}`),

  /** The wallet's watched open listings (newest first). */
  watchlist: (account: string) =>
    request<WatchlistEntry[]>(`/api/watchlist?account=${encodeURIComponent(account)}`),
  /** Add a listing to the wallet's watchlist (idempotent). */
  watchlistAdd: (account: string, listingId: string) =>
    request<{ ok: true; watching: boolean }>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ account, listingId }),
    }),
  /** Remove a listing from the wallet's watchlist (idempotent). */
  watchlistRemove: (account: string, listingId: string) =>
    request<{ ok: true; watching: boolean }>(
      `/api/watchlist/${listingId}?account=${encodeURIComponent(account)}`,
      { method: 'DELETE' },
    ),

  /** Quote a source-asset → USDC conversion (pay-with-any-asset). */
  quotePath: (body: PathQuoteRequest) =>
    request<PathQuoteResponse>('/api/tx/quote-path', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Build the path-payment top-up for an accepted quote. */
  pathPayment: (body: PathPaymentBuildRequest) =>
    request<BuildTxResponse>('/api/tx/path-payment', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  buildTrustline: (account: string, cardId: string) =>
    request<BuildTxResponse & { refId: string }>('/api/tx/trustline', {
      method: 'POST',
      body: JSON.stringify({ account, cardId }),
    }),
  submitClassic: (signedXdr: string) =>
    request<SubmitTxResponse>('/api/tx/submit-classic', {
      method: 'POST',
      body: JSON.stringify({ signedXdr }),
    }),

  /** Relay a passkey smart-wallet deployment (deploy-on-first-use). */
  passkeyDeploy: (signedXdr: string) =>
    request<SubmitTxResponse>('/api/tx/passkey-deploy', {
      method: 'POST',
      body: JSON.stringify({ signedXdr }),
    }),
  /** Relay a passkey-authorized buy_now / make_offer (gasless). */
  passkeySubmit: (body: PasskeySubmitRequest) =>
    request<SubmitTxResponse>('/api/tx/passkey-submit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Relay a passkey-authorized listing as a smart-wallet seller (gasless). */
  passkeyList: (body: PasskeyListRequest) =>
    request<SubmitTxResponse & { refId: string }>('/api/tx/passkey-list', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Mint (issue) a new card asset; distributes copies to `owner`. */
  mintCard: (body: MintCardRequest) =>
    request<MintCardResponse>('/api/cards/mint', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Deliver a minted card's copies once a classic owner has trusted the asset. */
  distributeCard: (cardId: string, owner: string) =>
    request<MintCardResponse>(`/api/cards/${cardId}/distribute`, {
      method: 'POST',
      body: JSON.stringify({ owner }),
    }),

  /** Dev-only: mint test USDC into a smart wallet so the first purchase has funds. */
  devFundWallet: (wallet: string, amountUsdc?: string) =>
    request<SubmitTxResponse & { amountUsdc: string }>('/api/dev/fund-wallet', {
      method: 'POST',
      body: JSON.stringify({ wallet, amountUsdc }),
    }),

  /** Reviews for a card (list + aggregate). */
  cardReviews: (cardId: string) =>
    request<CardReviewsResponse>(`/api/catalog/${encodeURIComponent(cardId)}/reviews`),
  /** Submit or update a card review (upsert). */
  submitCardReview: (cardId: string, body: CardReviewBody) =>
    request<CardReview>(`/api/catalog/${encodeURIComponent(cardId)}/reviews`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Delete (hard) a card review. */
  deleteCardReview: (cardId: string, reviewId: string, authorAddress: string) =>
    request<void>(
      `/api/catalog/${encodeURIComponent(cardId)}/reviews/${reviewId}?authorAddress=${encodeURIComponent(authorAddress)}`,
      { method: 'DELETE' },
    ),

  /** Public comments for a card (oldest first). */
  cardComments: (cardId: string) =>
    request<CardComment[]>(`/api/catalog/${encodeURIComponent(cardId)}/comments`),
  /** Post a new comment on a card. */
  postCardComment: (cardId: string, body: CardCommentBody) =>
    request<CardComment>(`/api/catalog/${encodeURIComponent(cardId)}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Soft-delete a card comment. */
  deleteCardComment: (cardId: string, commentId: string, authorAddress: string) =>
    request<void>(
      `/api/catalog/${encodeURIComponent(cardId)}/comments/${commentId}?authorAddress=${encodeURIComponent(authorAddress)}`,
      { method: 'DELETE' },
    ),
};

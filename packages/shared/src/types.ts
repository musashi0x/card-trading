/**
 * Domain types shared across the API and web app.
 *
 * Ownership and funds live on-chain (source of truth); these types describe the
 * Postgres read-mirror plus the request/response shapes the two apps exchange.
 */

export type ListingStatus = 'open' | 'sold' | 'cancelled';
export type OfferStatus = 'open' | 'withdrawn' | 'settled';

/** How a sold card reaches the buyer. */
export type Fulfillment = 'digital' | 'physical';

/**
 * Lifecycle of a physical-card escrow order. Mirrors the contract's `ORDER_*`
 * codes by position: funded(0), shipped(1), disputed(2), released(3), refunded(4).
 */
export type OrderStatus = 'funded' | 'shipped' | 'disputed' | 'released' | 'refunded';

export interface Card {
  id: string;
  name: string;
  set: string;
  rarity: string;
  imageUrl: string;
  /** Total issued supply (copies in existence). */
  supply: number;
  /** Stellar account that receives the creator royalty on resale (null = none). */
  creatorAccount: string | null;
  /** Creator royalty in basis points, applied on secondary sales (0 = none). */
  royaltyBps: number;
}

/**
 * One minted copy of a card: a unique token in the global collection
 * contract. `serial` is the copy's mint order within its card (1-based),
 * the number collectors price on.
 */
export interface CardCopy {
  id: string;
  cardId: string;
  card?: Card;
  /** Token id inside the collection contract. */
  tokenId: number;
  /** 1-based mint order within the card (#serial of card.supply). */
  serial: number;
  /** Wallet that currently owns this copy (mirrored from `owner_of`). */
  owner: string;
}

export interface Listing {
  id: string;
  cardId: string;
  card?: Card;
  /** The specific copy this listing sells. */
  cardCopyId: string;
  copy?: CardCopy;
  /** Stellar address of the seller. */
  seller: string;
  /** Price in test USDC, as a decimal string to avoid float drift. */
  priceUsdc: string;
  status: ListingStatus;
  /** Digital cards settle atomically; physical cards route through escrow. */
  fulfillment: Fulfillment;
  /** Listing id inside the settlement contract. */
  contractListingId: number | null;
  /** Tx hash of the on-chain `list` call. */
  escrowTxHash: string | null;
  createdAt: string;
}

/**
 * A physical-card escrow order: the buyer's USDC and the seller's card are both
 * held by the contract until the buyer confirms receipt, the window times out,
 * or an arbiter resolves a dispute.
 */
export interface Order {
  id: string;
  listingId: string;
  buyer: string;
  seller: string;
  amountUsdc: string;
  status: OrderStatus;
  /** Order id inside the settlement contract. */
  contractOrderId: number | null;
  /** Unix seconds after which `claim_timeout` may release to the seller. */
  confirmDeadline: number | null;
  /** Optional shipment tracking reference the seller attaches on dispatch. */
  trackingRef: string | null;
  /** Tx hash of the on-chain `purchase_escrow` call. */
  escrowTxHash: string | null;
  /** Tx hash of the terminal settlement (release/refund). */
  settleTxHash: string | null;
  createdAt: string;
}

export interface Offer {
  id: string;
  listingId: string;
  /** Stellar address of the buyer. */
  buyer: string;
  /** Offered amount in test USDC. */
  amountUsdc: string;
  status: OfferStatus;
  /** Offer id inside the settlement contract. */
  contractOfferId: number | null;
  /** Tx hash of the on-chain `make_offer` call. */
  escrowTxHash: string | null;
  createdAt: string;
}

export interface Trade {
  id: string;
  /** Null for barter swaps, which settle a trade proposal rather than a listing. */
  listingId: string | null;
  buyer: string;
  seller: string;
  priceUsdc: string;
  feeUsdc: string;
  /** Creator royalty paid on this settlement (0 on a primary sale). */
  royaltyUsdc: string;
  settleTxHash: string;
  /** Set on barter-swap settlements; links to the on-chain `execute_swap`. */
  swapTxHash: string | null;
  settledAt: string;
}

/** Barter trade-proposal lifecycle. */
export type TradeProposalStatus = 'proposed' | 'accepted' | 'declined' | 'cancelled' | 'expired';

/**
 * A peer-to-peer barter proposal mirrored from the contract's `SwapProposal`.
 * `giveCards`/`getCards` are the joined card metadata the inbox renders; the
 * `*CardIds` arrays are the underlying `cards.id` references.
 */
export interface TradeProposal {
  id: string;
  /** Address that proposed the swap and whose give-side cards are in custody. */
  proposer: string;
  /** Targeted counterparty who can accept or decline. */
  counterparty: string;
  giveCardIds: string[];
  getCardIds: string[];
  /** Joined card metadata for the give side (present on list responses). */
  giveCards?: Card[];
  /** Joined card metadata for the get side (present on list responses). */
  getCards?: Card[];
  /** One-way USDC sweetener from proposer to counterparty, decimal string. */
  cashUsdc: string;
  /** Platform fee taken on the sweetener at settlement, decimal string. */
  feeUsdc: string;
  status: TradeProposalStatus;
  /** Proposal id inside the settlement contract (null until `propose_swap` confirms). */
  contractSwapId: number | null;
  proposeTxHash: string | null;
  swapTxHash: string | null;
  /** ISO timestamp the proposal auto-expires. */
  expiresAt: string;
  createdAt: string;
}

/** Timed-auction lifecycle, mirroring the contract's `AUCTION_*` codes. */
export type AuctionStatus = 'open' | 'settled' | 'cancelled' | 'no_winner';

/**
 * A timed English auction. Ownership and escrowed funds live on-chain; this is
 * the read-mirror the catalog, countdown, and bid history render from.
 */
export interface Auction {
  id: string;
  cardId: string;
  card?: Card;
  /** The specific copy this auction sells. */
  cardCopyId: string;
  copy?: CardCopy;
  /** Auction id inside the settlement contract. */
  contractAuctionId: number | null;
  /** Stellar address of the seller. */
  seller: string;
  /** Opening price in test USDC, decimal string. */
  startPriceUsdc: string;
  /** Reserve price in test USDC; `0` means no reserve. */
  reservePriceUsdc: string;
  /** ISO timestamp the auction closes (extended on-chain by anti-snipe). */
  endsAt: string;
  /** Current high bidder's address, or null before the first bid. */
  highBidder: string | null;
  /** Current high bid in test USDC; `0` before the first bid. */
  highBidUsdc: string;
  status: AuctionStatus;
  /** Tx hash of the on-chain `create_auction` call. */
  escrowTxHash: string | null;
  /** Tx hash of the terminal `settle_auction`/`cancel_auction`. */
  settleTxHash: string | null;
  createdAt: string;
}

/** A single bid placed on an auction. */
export interface Bid {
  id: string;
  auctionId: string;
  /** Stellar address of the bidder. */
  bidder: string;
  /** Bid amount in test USDC, decimal string. */
  amountUsdc: string;
  /** Tx hash of the on-chain `place_bid` call. */
  escrowTxHash: string | null;
  /** Tx hash of the refund paid when this bid was outbid (null while still high). */
  refundTxHash: string | null;
  /** ISO timestamp when a higher bid superseded this one, or null if still leading. */
  outbidAt: string | null;
  createdAt: string;
}

/** Build a `create_auction` transaction (seller escrows a card copy into an auction). */
export interface CreateAuctionBuildRequest {
  cardCopyId: string;
  seller: string;
  /** Opening price in test USDC, decimal string. */
  startPriceUsdc: string;
  /** Reserve price in test USDC; omit or `0` for no reserve. */
  reservePriceUsdc?: string;
  /** Auction length in seconds (> 0, <= 30 days). */
  durationSecs: number;
}

/** Build a `place_bid` transaction for an auction. */
export interface PlaceBidBuildRequest {
  auctionId: string;
  bidder: string;
  /** Bid amount in test USDC, decimal string. */
  amountUsdc: string;
}

/** Build a `settle_auction` transaction (permissionless after `ends_at`). */
export interface SettleAuctionBuildRequest {
  auctionId: string;
  /** Fee-paying source account submitting the settlement. */
  account: string;
}

/** Build a `cancel_auction` transaction (seller reclaims a no-bid auction). */
export interface CancelAuctionBuildRequest {
  auctionId: string;
  seller: string;
}

/** A list of open/closed auctions for the catalog. */
export interface AuctionListResponse {
  auctions: Auction[];
}

/** Paginated bid history for a single auction, high bid first. */
export interface BidListResponse {
  bids: Bid[];
  /** Total bids on the auction (for pagination beyond the returned page). */
  total: number;
}

/** A user's bid joined with its auction's current state, for the my-bids page. */
export interface MyBid extends Bid {
  auction: Auction;
  /** True when this bidder is the auction's current high bidder. */
  isHighBidder: boolean;
}

/** All of a wallet's bids across auctions, for the my-bids page. */
export interface MyBidsResponse {
  bids: MyBid[];
}

/** A user's editable profile, keyed by wallet address. */
export interface ProfileResponse {
  address: string;
  displayName: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  avatarUrl: string | null;
  /** ISO timestamp the user row was first created (used for "member since"). */
  memberSince: string;
}

/** Editable profile fields. All optional — only provided fields are updated. */
export interface ProfileUpdateBody {
  displayName?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  avatarUrl?: string | null;
}

/** A single earned/locked achievement badge. */
export interface Achievement {
  key: string;
  name: string;
  description: string;
  earned: boolean;
}

/** Profile stats derived from on-chain trade/listing/review data. */
export interface ProfileStatsResponse {
  address: string;
  /** USDC value of cards the wallet has bought (sum of purchase prices). */
  collectionValueUsdc: string;
  cardsOwned: number;
  cardsSold: number;
  /** Average review rating (1–5), or null when the wallet has no reviews. */
  sellerRating: number | null;
  reviewCount: number;
  /** Purchases ÷ offers made, as a 0–100 percentage; null when no offers. */
  winRate: number | null;
  achievements: Achievement[];
}

/** A counterparty review as returned by the reviews endpoint. */
export interface ReviewResponse {
  id: string;
  reviewerAddress: string;
  revieweeAddress: string;
  tradeId: string | null;
  rating: number;
  text: string | null;
  createdAt: string;
}

/** Body for posting a review of a counterparty. */
export interface ReviewCreateBody {
  reviewerAddress: string;
  tradeId: string;
  rating: number;
  text?: string | null;
}

/**
 * One watched open listing for a wallet. Extends the listing shape (with its
 * joined card) so the web can render it exactly like a browse-grid lot, plus the
 * watchlist row's own id and timestamp.
 */
export interface WatchlistEntry extends Listing {
  /** The watchlist row id. */
  watchId: string;
  /** When the wallet added this listing to its watchlist. */
  watchedAt: string;
}

/**
 * How a holding's current value was derived by the valuation waterfall:
 * `"trade"` = most recent settled trade price; `"listing"` = lowest open listing
 * price; `null` = no market signal (value is `"0"`, render as "—").
 */
export type ValuedAt = 'trade' | 'listing' | null;

/** One card a wallet holds, valued live against the market. */
export interface PortfolioHolding {
  cardId: string;
  name: string;
  rarity: string;
  imageUrl: string;
  /** Current value in USDC, decimal string; `"0"` when `valuedAt` is null. */
  value: string;
  /** Which waterfall tier produced `value`. */
  valuedAt: ValuedAt;
  /** What the account paid for the card (most recent purchase), decimal string. */
  costBasis: string;
  /** False when no purchase trade exists (minted/transferred in) — cost is `"0"`. */
  costBasisKnown: boolean;
  /** True when the account currently has this card open-listed (still owns it). */
  listed: boolean;
}

/** Value-share of one rarity group across the portfolio. */
export interface PortfolioAllocation {
  rarity: string;
  /** Summed value of holdings of this rarity, decimal string. */
  value: string;
  /** Share of `totalValue`, 0–100. */
  pct: number;
}

/** The best- or worst-returning holding by unrealized return percentage. */
export interface PortfolioPerformer {
  cardId: string;
  name: string;
  /** Unrealized return: `(value - costBasis) / costBasis * 100`. */
  returnPct: number;
}

/** One month of synthesized portfolio value in the 12-month history series. */
export interface PortfolioHistoryEntry {
  /** Calendar month, `YYYY-MM`. */
  month: string;
  /** Portfolio value at that month-end, decimal string. */
  value: string;
}

/**
 * A connected wallet's portfolio: real on-chain holdings with per-card valuation
 * and cost basis, aggregate totals and unrealized P&L, rarity allocation,
 * best/worst performer, and a 12-month value-history series. All derived on the
 * fly from the `cards`, `listings`, and `trades` tables — no snapshot store.
 */
export interface PortfolioResponse {
  /** The wallet this portfolio is for (`G…` or `C…`). */
  account: string;
  holdings: PortfolioHolding[];
  /** Sum of every holding's value, decimal string. */
  totalValue: string;
  /** Sum of cost basis over holdings with `costBasisKnown: true`, decimal string. */
  totalCost: string;
  /** `knownValue - totalCost` (unrealized gain on holdings with a known cost). */
  unrealizedGain: string;
  /** `unrealizedGain / totalCost * 100`, or null when `totalCost` is 0. */
  unrealizedGainPct: number | null;
  /** Allocation entries, ordered legendary → epic → rare → common. */
  rarity: PortfolioAllocation[];
  bestPerformer: PortfolioPerformer | null;
  worstPerformer: PortfolioPerformer | null;
  /** 12 monthly snapshots, oldest-first, ending at the current month. */
  history: PortfolioHistoryEntry[];
}

/**
 * A Stellar asset the buyer can pay with. `issuer` is `null` for the native
 * asset (XLM); otherwise it's the issuing account of a classic credit asset.
 */
export interface StellarAsset {
  code: string;
  issuer: string | null;
}

/**
 * Request to quote a source-asset → USDC conversion for a purchase. The API
 * prices it against the Stellar DEX (Horizon strict-receive path finding).
 */
export interface PathQuoteRequest {
  /** Buyer account paying with `sourceAsset`. */
  buyer: string;
  /** Asset the buyer wants to spend (XLM has `issuer: null`). */
  sourceAsset: StellarAsset;
  /** Exact USDC the settlement needs, as a decimal string. */
  destUsdc: string;
}

/** A priced conversion route the buyer can accept and then submit. */
export interface PathQuoteResponse {
  sourceAsset: StellarAsset;
  /** Exact USDC the path payment will deliver. */
  destUsdc: string;
  /** Estimated source-asset spend at the current quote, decimal string. */
  sendAmount: string;
  /** Hard cap on the source-asset spend = `sendAmount` + slippage, decimal string. */
  sendMax: string;
  /** Slippage tolerance baked into `sendMax`, in basis points. */
  slippageBps: number;
  /** Intermediate hops Horizon found (empty for a direct path). */
  path: StellarAsset[];
}

/**
 * Request to build the `PathPaymentStrictReceive` for an accepted quote. The
 * `sendMax`/`path` echo a prior {@link PathQuoteResponse} so the buyer can never
 * spend more than they were quoted plus slippage.
 */
export interface PathPaymentBuildRequest {
  buyer: string;
  sourceAsset: StellarAsset;
  destUsdc: string;
  sendMax: string;
  path: StellarAsset[];
}

/** The contract action a build-transaction request targets. */
export type TradeAction =
  | 'list'
  | 'cancel_listing'
  | 'make_offer'
  | 'withdraw_offer'
  | 'accept_offer'
  | 'buy_now'
  | 'purchase_escrow'
  | 'mark_shipped'
  | 'confirm_receipt'
  | 'claim_timeout'
  | 'dispute'
  | 'create_auction'
  | 'place_bid'
  | 'settle_auction'
  | 'cancel_auction'
  | 'claim_refund';

/** Response from the API's transaction-build endpoints. */
export interface BuildTxResponse {
  /** Unsigned transaction envelope (XDR) for the wallet to sign. */
  xdr: string;
  /** Network passphrase the wallet must sign against. */
  networkPassphrase: string;
}

/** Request to submit a wallet-signed transaction. */
export interface SubmitTxRequest {
  signedXdr: string;
}

/**
 * A passkey smart-wallet account: a Soroban contract account (a `C…` address)
 * whose authorization is verified by a secp256r1 passkey, not a classic `G…`
 * keypair. This is the buyer of record for passkey checkouts.
 */
export interface SmartWalletAccount {
  /** Smart-wallet contract address (`C…`). */
  contractId: string;
  /** Base64url WebAuthn credential id that authorizes this wallet. */
  keyId: string;
}

/**
 * Submit a passkey-authorized Soroban invocation for gasless relay submission.
 *
 * The browser builds the marketplace call with the smart wallet as buyer,
 * passkey-signs its authorization entry (and, on first use, bundles wallet
 * deployment), and serializes the result to `signedXdr`. The API relays it
 * through the sponsoring relay rather than a classic Horizon submit.
 */
export interface PasskeySubmitRequest {
  /** Buyer-side action this settles. */
  action: Extract<TradeAction, 'buy_now' | 'make_offer'>;
  /** Listing the action targets (a buyer-side action always targets a listing). */
  listingId: string;
  /** Smart-wallet contract address (`C…`) acting as buyer of record. */
  buyer: string;
  /** Passkey-signed transaction envelope (XDR), ready for the relay. */
  signedXdr: string;
  /** Offer amount; required for `make_offer`, ignored for `buy_now`. */
  amountUsdc?: string;
}

/**
 * Submit a passkey-authorized `list` for gasless relay submission. The smart
 * wallet is the seller of record; the browser builds the marketplace `list`
 * call with the smart wallet as seller, passkey-signs its authorization entry
 * (and, on first use, bundles wallet deployment), and serializes the result to
 * `signedXdr`. The API relays it rather than using a classic Horizon submit.
 */
export interface PasskeyListRequest {
  /** The specific copy being listed; the API resolves its collection token id. */
  cardCopyId: string;
  /** Smart-wallet contract address (`C…`) acting as seller of record. */
  seller: string;
  /** Asking price in test USDC, as a decimal string. */
  priceUsdc: string;
  /** Passkey-signed transaction envelope (XDR), ready for the relay. */
  signedXdr: string;
}

export interface SubmitTxResponse {
  hash: string;
  successful: boolean;
}

/**
 * Mint a brand-new card. The platform mints `supply` unique copies (tokens)
 * on the global collection contract, server-signed, and (when
 * `royaltyBps > 0`) registers `owner` as each token's creator royalty payee.
 * NFT ownership needs no trustline, so the flow is identical for classic
 * (`G…`) and smart-wallet (`C…`) owners.
 */
export interface MintCardRequest {
  /** Wallet that will own the minted copies — classic `G…` or smart-wallet `C…`. */
  owner: string;
  name: string;
  set: string;
  rarity: string;
  /** Card art: an http(s) URL or a `data:` URL from the upload picker. */
  imageUrl: string;
  /** How many copies to issue (>= 1). */
  supply: number;
  /** Creator royalty in basis points (0–maxRoyaltyBps); 0 = no royalty. */
  royaltyBps: number;
  /**
   * Royalty payee registered on each minted token; defaults to `owner`.
   * Lets a platform mint to a holder while royalties flow to the creator.
   */
  creatorAccount?: string;
}

/** Result of a mint: the card plus its freshly minted copies, owned by `owner`. */
export interface MintCardResponse {
  card: Card;
  copies: CardCopy[];
}

/** The three ranked leaderboard boards. */
export type LeaderboardBoard = 'collectors' | 'sellers' | 'traders';

/**
 * One ranked entry on a leaderboard. Every board returns the same row shape; the
 * fields relevant to the requested board are populated and the rest carry their
 * zero value (`"0"` / `0` / `null`). Monetary fields are decimal strings (USDC)
 * to avoid float drift; counts are numbers.
 */
export interface LeaderboardRow {
  /** 1-based position on the board (descending by the board's primary metric). */
  rank: number;
  stellarAddress: string;
  // Collectors metrics
  /** Season collection value (sum of last buy prices of held cards), decimal string. */
  collectionValue: string;
  /** Net cards currently held (buys − sells). */
  cardsHeld: number;
  /** Buy-side win rate as a 0–100 percentage, or null when no offers were made. */
  winRate: number | null;
  // Sellers metrics
  /** Gross sales volume over the trailing 90 days, decimal string. */
  salesVolume90d: string;
  /** Number of sell-side trades in the 90-day window. */
  salesCount: number;
  /** Average counterparty rating (1–5), or null when unavailable. */
  avgRating: number | null;
  // Traders metrics
  /** All-time realized profit (sell net − buy cost), decimal string. */
  realizedProfit: string;
  /** ROI as a formatted percentage (e.g. `"+31.0%"`, `"−12.3%"`), or null with no buys. */
  roi: string | null;
  /** Completed buy→sell card pairs. */
  flipCount: number;
}

/**
 * The requesting account's own standing on a board. Mirrors {@link LeaderboardRow}
 * but `rank` is `null` when the account has no qualifying activity on the board.
 */
export interface LeaderboardOwnStanding extends Omit<LeaderboardRow, 'rank'> {
  rank: number | null;
}

/** Response from `GET /api/leaderboard`. */
export interface LeaderboardResponse {
  board: LeaderboardBoard;
  /** Top-N ranked rows for the board. */
  rows: LeaderboardRow[];
  /** The requesting account's standing, or null when `account` was omitted. */
  ownStanding: LeaderboardOwnStanding | null;
  /**
   * Whether seller ratings are available (the `reviews` table exists). `true`/
   * `false` on the sellers board; `null` on boards where rating is not a metric.
   */
  ratingAvailable: boolean | null;
  /** ISO timestamp the cached board rows were computed. */
  cachedAt: string;
}

/** A review left on a card by a previous owner/trader. */
export interface CardReview {
  id: string;
  cardId: string;
  authorAddress: string;
  stars: number;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Aggregate + list response for card reviews. */
export interface CardReviewsResponse {
  reviews: CardReview[];
  aggregate: {
    averageStars: number | null;
    reviewCount: number;
  };
}

/** Body for submitting or updating a card review. */
export interface CardReviewBody {
  authorAddress: string;
  stars: number;
  body?: string | null;
}

/** A public comment on a card detail page. */
export interface CardComment {
  id: string;
  cardId: string;
  /** Null for soft-deleted comments. */
  authorAddress: string | null;
  /** Replaced with "[comment removed]" when soft-deleted. */
  body: string;
  createdAt: string;
  deletedAt: string | null;
}

/** Body for posting a card comment. */
export interface CardCommentBody {
  authorAddress: string;
  body: string;
}

/** Structured, actionable error returned by pre-flight validation. */
export interface ApiError {
  error: string;
  /**
   * Machine-readable code, e.g. `MISSING_TRUSTLINE`, `INSUFFICIENT_BALANCE`,
   * or `NO_PATH` when no DEX route exists for a pay-with-any-asset conversion.
   */
  code: string;
  /** Optional hint the UI can act on (e.g. the asset needing a trustline). */
  details?: Record<string, unknown>;
}

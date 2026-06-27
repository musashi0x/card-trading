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
  /** Stellar asset code (issued by the platform issuer). */
  assetCode: string;
  /** Stellar account that issued the asset. */
  issuer: string;
  /** Card token's Stellar Asset Contract address (`C…`), or null if not deployed. */
  sacAddress: string | null;
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

export interface Listing {
  id: string;
  cardId: string;
  card?: Card;
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
  listingId: string;
  buyer: string;
  seller: string;
  priceUsdc: string;
  feeUsdc: string;
  /** Creator royalty paid on this settlement (0 on a primary sale). */
  royaltyUsdc: string;
  settleTxHash: string;
  settledAt: string;
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
  assetCode: string;
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
  | 'dispute';

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
  cardId: string;
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
 * Mint (issue) a brand-new card asset. The platform issues the asset, deploys
 * its Stellar Asset Contract, distributes `supply` copies to `owner`, and (when
 * `royaltyBps > 0`) registers `owner` as the card's creator royalty payee.
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
}

/**
 * Result of a mint. For a smart-wallet (`C…`) owner the copies are minted
 * gaslessly server-side (`minted: true`). For a classic (`G…`) owner that does
 * not yet trust the new asset, `minted` is false and `trustlineXdr` must be
 * signed + submitted before calling `distribute` to receive the copies.
 */
export interface MintCardResponse {
  card: Card;
  /** Whether the owner already holds the issued copies. */
  minted: boolean;
  /** Set when a classic owner must establish a trustline before distribution. */
  trustlineXdr?: string;
  networkPassphrase?: string;
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

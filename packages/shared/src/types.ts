/**
 * Domain types shared across the API and web app.
 *
 * Ownership and funds live on-chain (source of truth); these types describe the
 * Postgres read-mirror plus the request/response shapes the two apps exchange.
 */

export type ListingStatus = 'open' | 'sold' | 'cancelled';
export type OfferStatus = 'open' | 'withdrawn' | 'settled';

export interface Card {
  id: string;
  /** Stellar asset code (issued by the platform issuer). */
  assetCode: string;
  /** Stellar account that issued the asset. */
  issuer: string;
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
  /** Listing id inside the settlement contract. */
  contractListingId: number | null;
  /** Tx hash of the on-chain `list` call. */
  escrowTxHash: string | null;
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

/** The contract action a build-transaction request targets. */
export type TradeAction =
  | 'list'
  | 'cancel_listing'
  | 'make_offer'
  | 'withdraw_offer'
  | 'accept_offer'
  | 'buy_now';

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

export interface SubmitTxResponse {
  hash: string;
  successful: boolean;
}

/** Structured, actionable error returned by pre-flight validation. */
export interface ApiError {
  error: string;
  /** Machine-readable code, e.g. `MISSING_TRUSTLINE`, `INSUFFICIENT_BALANCE`. */
  code: string;
  /** Optional hint the UI can act on (e.g. the asset needing a trustline). */
  details?: Record<string, unknown>;
}

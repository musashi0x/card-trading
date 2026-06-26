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

export interface SubmitTxResponse {
  hash: string;
  successful: boolean;
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

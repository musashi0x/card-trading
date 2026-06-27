/**
 * Zod request schemas shared by the API (validation) and web (typed clients).
 */

import { z } from 'zod';

const stellarAddress = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar public key (G...)');

const stellarContractAddress = z
  .string()
  .regex(/^C[A-Z2-7]{55}$/, 'Must be a valid Stellar contract address (C...)');

/** Either a classic account (`G…`) or a smart-wallet contract account (`C…`). */
const stellarAccount = z
  .string()
  .regex(/^[GC][A-Z2-7]{55}$/, 'Must be a valid Stellar address (G… or C…)');

const decimalAmount = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, 'Must be a positive decimal with up to 7 places');

/** Listing fulfillment: `digital` settles atomically, `physical` via escrow. */
export const fulfillmentSchema = z.enum(['digital', 'physical']);

export const listInputSchema = z.object({
  cardId: z.string().uuid(),
  seller: stellarAddress,
  priceUsdc: decimalAmount,
  /** Defaults to `digital` so existing callers keep the atomic-swap behaviour. */
  fulfillment: fulfillmentSchema.default('digital'),
});

export const cancelListingSchema = z.object({
  listingId: z.string().uuid(),
  seller: stellarAddress,
});

export const makeOfferSchema = z.object({
  listingId: z.string().uuid(),
  buyer: stellarAddress,
  amountUsdc: decimalAmount,
});

export const withdrawOfferSchema = z.object({
  offerId: z.string().uuid(),
  buyer: stellarAddress,
});

export const acceptOfferSchema = z.object({
  offerId: z.string().uuid(),
  seller: stellarAddress,
});

export const buyNowSchema = z.object({
  listingId: z.string().uuid(),
  buyer: stellarAddress,
});

// --- physical escrow orders ---

/** Buyer locks the asking price against a physical listing. */
export const purchaseEscrowSchema = z.object({
  listingId: z.string().uuid(),
  buyer: stellarAddress,
});

/**
 * A classic-wallet action on an existing order. `account` is the actor (seller
 * for ship, buyer for confirm/dispute, or any fee-payer for timeout); the route
 * checks the role against the order row.
 */
export const orderActionSchema = z.object({
  orderId: z.string().uuid(),
  account: stellarAddress,
});

/** Arbiter resolution of a disputed order (server-signed with the arbiter key). */
export const resolveOrderSchema = z.object({
  orderId: z.string().uuid(),
  /** true = refund the buyer (card back to seller); false = release the seller. */
  refund: z.boolean(),
});

/**
 * Passkey-authorized order action: a smart-wallet (`C…`) actor on the escrow
 * flow. `listingId` is required for `purchase_escrow`; `orderId` for the rest.
 */
export const passkeyOrderSchema = z.object({
  action: z.enum(['purchase_escrow', 'confirm_receipt', 'dispute', 'mark_shipped']),
  account: stellarContractAddress,
  listingId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  signedXdr: z.string().min(1),
});

export const submitTxSchema = z.object({
  signedXdr: z.string().min(1),
});

/**
 * Passkey-authorized submit: the buyer is a smart-wallet contract account
 * (`C…`), and the signed envelope is relayed (gasless) rather than submitted
 * with a classic-account source.
 */
export const passkeySubmitSchema = z.object({
  action: z.enum(['buy_now', 'make_offer']),
  /** Listing the buyer-side action targets. */
  listingId: z.string().uuid(),
  /** Smart-wallet contract address (`C…`) acting as buyer of record. */
  buyer: stellarContractAddress,
  /** Passkey-signed envelope (XDR), ready for the relay. */
  signedXdr: z.string().min(1),
  /** Offer amount; required for `make_offer`, ignored for `buy_now`. */
  amountUsdc: decimalAmount.optional(),
});

/**
 * Passkey-authorized listing: the seller is a smart-wallet contract account
 * (`C…`). The browser builds + passkey-signs the `list` call client-side and the
 * signed envelope is relayed (gasless), so this path does not reuse the `G…`-only
 * `/list` build endpoint.
 */
export const passkeyListSchema = z.object({
  cardId: z.string().uuid(),
  /** Smart-wallet contract address (`C…`) acting as seller of record. */
  seller: stellarContractAddress,
  priceUsdc: decimalAmount,
  /** Passkey-signed envelope (XDR), ready for the relay. */
  signedXdr: z.string().min(1),
});

/** A payable asset: `issuer: null` denotes native XLM, else a credit asset. */
export const stellarAssetSchema = z.object({
  code: z.string().min(1).max(12),
  issuer: stellarAddress.nullable(),
});

export const pathQuoteSchema = z.object({
  buyer: stellarAddress,
  sourceAsset: stellarAssetSchema,
  destUsdc: decimalAmount,
});

export const pathPaymentBuildSchema = z.object({
  buyer: stellarAddress,
  sourceAsset: stellarAssetSchema,
  destUsdc: decimalAmount,
  sendMax: decimalAmount,
  path: z.array(stellarAssetSchema),
});

// --- timed auctions ---

/** ~30 days, mirroring the contract's `MAX_AUCTION_DURATION_SECS`. */
const MAX_AUCTION_DURATION_SECS = 2_592_000;

/** Seller escrows a card into a timed auction. */
export const createAuctionSchema = z.object({
  cardId: z.string().uuid(),
  seller: stellarAddress,
  startPriceUsdc: decimalAmount,
  /** Optional reserve; defaults to no reserve (`0`). Must be >= start when set (checked in the route). */
  reservePriceUsdc: decimalAmount.optional(),
  durationSecs: z.number().int().positive().max(MAX_AUCTION_DURATION_SECS),
});

/** Bidder escrows USDC against an open auction. */
export const placeBidSchema = z.object({
  auctionId: z.string().uuid(),
  bidder: stellarAddress,
  amountUsdc: decimalAmount,
});

/** Settle an expired auction; `account` is just the fee-paying source. */
export const settleAuctionSchema = z.object({
  auctionId: z.string().uuid(),
  account: stellarAddress,
});

/** Seller cancels a no-bid auction and reclaims the card. */
export const cancelAuctionSchema = z.object({
  auctionId: z.string().uuid(),
  seller: stellarAddress,
});

// --- barter trade proposals ---

/**
 * Create a barter proposal. `proposer`/`counterparty` may be classic (`G…`) or
 * smart-wallet (`C…`) accounts; the give side must hold at least one card, and
 * `cashUsdc` is an optional one-way sweetener. Self-trades are rejected here.
 */
export const proposeSwapSchema = z
  .object({
    proposer: stellarAccount,
    counterparty: stellarAccount,
    giveCardIds: z.array(z.string().uuid()).min(1, 'Select at least one card to give'),
    getCardIds: z.array(z.string().uuid()),
    cashUsdc: decimalAmount.optional(),
  })
  .refine((v) => v.proposer !== v.counterparty, {
    message: 'You cannot propose a trade to yourself',
    path: ['counterparty'],
  });

/** Act on an existing proposal (accept/decline/cancel). `account` is the actor. */
export const swapActionSchema = z.object({
  account: stellarAccount,
});

/** List proposals for a party, optionally narrowed to one status. */
export const swapQuerySchema = z.object({
  party: stellarAccount,
  status: z.enum(['proposed', 'accepted', 'declined', 'cancelled', 'expired']).optional(),
});

export const listingsQuerySchema = z.object({
  status: z.enum(['open', 'sold', 'cancelled']).optional(),
  q: z.string().optional(),
  set: z.string().optional(),
  rarity: z.string().optional(),
});

export type ListInput = z.infer<typeof listInputSchema>;
export type MakeOfferInput = z.infer<typeof makeOfferSchema>;
export type AcceptOfferInput = z.infer<typeof acceptOfferSchema>;
export type BuyNowInput = z.infer<typeof buyNowSchema>;
export type PurchaseEscrowInput = z.infer<typeof purchaseEscrowSchema>;
export type OrderActionInput = z.infer<typeof orderActionSchema>;
export type ResolveOrderInput = z.infer<typeof resolveOrderSchema>;
export type PasskeyOrderInput = z.infer<typeof passkeyOrderSchema>;
export type PasskeySubmitInput = z.infer<typeof passkeySubmitSchema>;
export type PasskeyListInput = z.infer<typeof passkeyListSchema>;
export type PathQuoteInput = z.infer<typeof pathQuoteSchema>;
export type PathPaymentBuildInput = z.infer<typeof pathPaymentBuildSchema>;
export type CreateAuctionInput = z.infer<typeof createAuctionSchema>;
export type PlaceBidInput = z.infer<typeof placeBidSchema>;
export type SettleAuctionInput = z.infer<typeof settleAuctionSchema>;
export type CancelAuctionInput = z.infer<typeof cancelAuctionSchema>;
export type ProposeSwapInput = z.infer<typeof proposeSwapSchema>;
export type SwapActionInput = z.infer<typeof swapActionSchema>;
export type SwapQueryInput = z.infer<typeof swapQuerySchema>;

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

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

export const listInputSchema = z.object({
  cardId: z.string().uuid(),
  seller: stellarAddress,
  priceUsdc: decimalAmount,
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
export type PasskeySubmitInput = z.infer<typeof passkeySubmitSchema>;
export type PasskeyListInput = z.infer<typeof passkeyListSchema>;
export type PathQuoteInput = z.infer<typeof pathQuoteSchema>;
export type PathPaymentBuildInput = z.infer<typeof pathPaymentBuildSchema>;

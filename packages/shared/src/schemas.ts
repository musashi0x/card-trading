/**
 * Zod request schemas shared by the API (validation) and web (typed clients).
 */

import { z } from 'zod';

const stellarAddress = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar public key (G...)');

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

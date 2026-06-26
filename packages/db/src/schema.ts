/**
 * Drizzle schema — the read-optimized mirror of on-chain state.
 *
 * The chain is the source of truth for ownership and funds; these tables make
 * browse/search/history fast and hold off-chain card metadata. The indexer
 * keeps listing/offer/trade rows reconciled with the contract.
 */

import { sql } from 'drizzle-orm';
import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const listingStatus = pgEnum('listing_status', ['open', 'sold', 'cancelled']);
export const offerStatus = pgEnum('offer_status', ['open', 'withdrawn', 'settled']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  stellarAddress: text('stellar_address').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cards = pgTable('cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  assetCode: text('asset_code').notNull(),
  issuer: text('issuer').notNull(),
  /** Stellar Asset Contract address (filled after deploy), used as the token in contract calls. */
  sacAddress: text('sac_address'),
  name: text('name').notNull(),
  set: text('set').notNull(),
  rarity: text('rarity').notNull(),
  imageUrl: text('image_url').notNull(),
  supply: integer('supply').notNull().default(1),
});

export const listings = pgTable('listings', {
  id: uuid('id').defaultRandom().primaryKey(),
  cardId: uuid('card_id')
    .notNull()
    .references(() => cards.id),
  seller: text('seller').notNull(),
  priceUsdc: numeric('price_usdc', { precision: 20, scale: 7 }).notNull(),
  status: listingStatus('status').notNull().default('open'),
  /** Listing id inside the settlement contract (set once the on-chain `list` confirms). */
  contractListingId: integer('contract_listing_id'),
  escrowTxHash: text('escrow_tx_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const offers = pgTable('offers', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id')
    .notNull()
    .references(() => listings.id),
  buyer: text('buyer').notNull(),
  amountUsdc: numeric('amount_usdc', { precision: 20, scale: 7 }).notNull(),
  status: offerStatus('status').notNull().default('open'),
  contractOfferId: integer('contract_offer_id'),
  escrowTxHash: text('escrow_tx_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const trades = pgTable('trades', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id')
    .notNull()
    .references(() => listings.id),
  buyer: text('buyer').notNull(),
  seller: text('seller').notNull(),
  priceUsdc: numeric('price_usdc', { precision: 20, scale: 7 }).notNull(),
  feeUsdc: numeric('fee_usdc', { precision: 20, scale: 7 }).notNull(),
  settleTxHash: text('settle_tx_hash').notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export type CardRow = typeof cards.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type OfferRow = typeof offers.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;

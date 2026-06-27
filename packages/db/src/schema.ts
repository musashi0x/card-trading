/**
 * Drizzle schema — the read-optimized mirror of on-chain state.
 *
 * The chain is the source of truth for ownership and funds; these tables make
 * browse/search/history fast and hold off-chain card metadata. The indexer
 * keeps listing/offer/trade rows reconciled with the contract.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
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
/** How a sold card reaches the buyer. */
export const fulfillment = pgEnum('fulfillment', ['digital', 'physical']);
/**
 * Physical-escrow order lifecycle. Values mirror the contract's `ORDER_*` codes
 * by position (funded=0 … refunded=4), so the indexer can map a code to a status.
 */
export const orderStatus = pgEnum('order_status', [
  'funded',
  'shipped',
  'disputed',
  'released',
  'refunded',
]);

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
  /** Stellar account that receives the creator royalty on resale (null = none). */
  creatorAccount: text('creator_account'),
  /** Creator royalty in basis points, applied on secondary sales (0 = none). */
  royaltyBps: integer('royalty_bps').notNull().default(0),
});

export const listings = pgTable('listings', {
  id: uuid('id').defaultRandom().primaryKey(),
  cardId: uuid('card_id')
    .notNull()
    .references(() => cards.id),
  seller: text('seller').notNull(),
  priceUsdc: numeric('price_usdc', { precision: 20, scale: 7 }).notNull(),
  status: listingStatus('status').notNull().default('open'),
  /** Digital cards settle atomically; physical cards route through escrow. */
  fulfillment: fulfillment('fulfillment').notNull().default('digital'),
  /** Listing id inside the settlement contract (set once the on-chain `list` confirms). */
  contractListingId: integer('contract_listing_id'),
  escrowTxHash: text('escrow_tx_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Physical-card escrow orders — the read-mirror of the contract's `Order` state.
 * The chain holds the funds and card; these rows make order status queryable and
 * carry off-chain shipment tracking the contract doesn't store.
 */
export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id')
    .notNull()
    .references(() => listings.id),
  buyer: text('buyer').notNull(),
  seller: text('seller').notNull(),
  amountUsdc: numeric('amount_usdc', { precision: 20, scale: 7 }).notNull(),
  status: orderStatus('status').notNull().default('funded'),
  /** Order id inside the settlement contract (set once `purchase_escrow` confirms). */
  contractOrderId: integer('contract_order_id'),
  /** Unix seconds after which the seller may claim funds by timeout. */
  confirmDeadline: bigint('confirm_deadline', { mode: 'number' }),
  /** Off-chain shipment tracking reference the seller attaches on dispatch. */
  trackingRef: text('tracking_ref'),
  escrowTxHash: text('escrow_tx_hash'),
  /** Tx hash of the terminal settlement (release or refund). */
  settleTxHash: text('settle_tx_hash'),
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
  /** Creator royalty paid on this settlement (0 on a primary sale). */
  royaltyUsdc: numeric('royalty_usdc', { precision: 20, scale: 7 }).notNull().default('0'),
  settleTxHash: text('settle_tx_hash').notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export type CardRow = typeof cards.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type OfferRow = typeof offers.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;

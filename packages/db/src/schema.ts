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
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
  bio: text('bio'),
  location: text('location'),
  website: text('website'),
  avatarUrl: text('avatar_url'),
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

export const trades = pgTable(
  'trades',
  {
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
  },
  // Composite indexes for the leaderboard aggregations: sellers group by seller
  // over a 90-day window, collectors/traders group by buyer, both ordered by
  // settlement time.
  (t) => ({
    sellerSettledIdx: index('trades_seller_settled_at_idx').on(t.seller, t.settledAt),
    buyerSettledIdx: index('trades_buyer_settled_at_idx').on(t.buyer, t.settledAt),
  }),
);

/**
 * Counterparty reviews. Addresses are stored as plain text (not FKs) so a review
 * never requires a `users` row for either party. One review per (reviewer, trade)
 * is enforced in the API layer.
 */
export const reviews = pgTable('reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  reviewerAddress: text('reviewer_address').notNull(),
  revieweeAddress: text('reviewee_address').notNull(),
  tradeId: uuid('trade_id').references(() => trades.id),
  rating: integer('rating').notNull(),
  text: text('text'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Per-wallet watchlist. A row means `account` is watching a specific open
 * listing. Keyed by listing (not card) so it captures the price the user cared
 * about; rows are removed by the indexer when the listing closes.
 */
export const watchlist = pgTable(
  'watchlist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    account: text('account').notNull(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    accountListingUnique: uniqueIndex('watchlist_account_listing_unique').on(t.account, t.listingId),
  }),
);

export type CardRow = typeof cards.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type OfferRow = typeof offers.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type WatchlistRow = typeof watchlist.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type UserRow = typeof users.$inferSelect;

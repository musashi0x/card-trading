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
/**
 * Timed-auction lifecycle. Values mirror the contract's `AUCTION_*` codes by
 * position (open=0 … no_winner=3), so the indexer can map a code to a status.
 */
export const auctionStatus = pgEnum('auction_status', [
  'open',
  'settled',
  'cancelled',
  'no_winner',
]);
/** Barter trade-proposal lifecycle. `proposed` → accepted/declined/cancelled/expired. */
export const tradeProposalStatus = pgEnum('trade_proposal_status', [
  'proposed',
  'accepted',
  'declined',
  'cancelled',
  'expired',
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

/**
 * Timed English auctions — the read-mirror of the contract's `Auction` state.
 * The chain holds the escrowed card and bid funds; these rows make the catalog,
 * countdown, and bid history queryable. The `bids` table carries one row per bid.
 */
export const auctions = pgTable(
  'auctions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Auction id inside the settlement contract (set once `create_auction` confirms). */
    contractAuctionId: integer('contract_auction_id'),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    seller: text('seller').notNull(),
    startPriceUsdc: numeric('start_price_usdc', { precision: 20, scale: 7 }).notNull(),
    reservePriceUsdc: numeric('reserve_price_usdc', { precision: 20, scale: 7 }).notNull().default('0'),
    /** Settlement deadline; extended on-chain by anti-snipe and mirrored here. */
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Current high bidder's address (null until the first bid). */
    highBidder: text('high_bidder'),
    highBidUsdc: numeric('high_bid_usdc', { precision: 20, scale: 7 }).notNull().default('0'),
    status: auctionStatus('status').notNull().default('open'),
    escrowTxHash: text('escrow_tx_hash'),
    /** Tx hash of the terminal `settle_auction`/`cancel_auction`. */
    settleTxHash: text('settle_tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusEndsIdx: index('auctions_status_ends_at_idx').on(t.status, t.endsAt),
  }),
);

/**
 * One row per bid placed on an auction. `outbidAt` is set by the indexer when a
 * higher bid supersedes this one, driving the "outbid" visual treatment.
 */
export const bids = pgTable(
  'bids',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id),
    bidder: text('bidder').notNull(),
    amountUsdc: numeric('amount_usdc', { precision: 20, scale: 7 }).notNull(),
    /** Opaque contract-side reference for the bid, when one is available. */
    contractBidRef: text('contract_bid_ref'),
    escrowTxHash: text('escrow_tx_hash'),
    /** Tx hash of the refund paid when this bid was outbid (or settlement refund). */
    refundTxHash: text('refund_tx_hash'),
    /** Set when a higher bid superseded this one. */
    outbidAt: timestamp('outbid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    auctionAmountIdx: index('bids_auction_amount_idx').on(t.auctionId, t.amountUsdc),
    bidderIdx: index('bids_bidder_idx').on(t.bidder),
  }),
);

export const trades = pgTable(
  'trades',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Null for barter swaps, which settle a `trade_proposals` row, not a listing. */
    listingId: uuid('listing_id').references(() => listings.id),
    buyer: text('buyer').notNull(),
    seller: text('seller').notNull(),
    priceUsdc: numeric('price_usdc', { precision: 20, scale: 7 }).notNull(),
    feeUsdc: numeric('fee_usdc', { precision: 20, scale: 7 }).notNull(),
    /** Creator royalty paid on this settlement (0 on a primary sale). */
    royaltyUsdc: numeric('royalty_usdc', { precision: 20, scale: 7 }).notNull().default('0'),
    settleTxHash: text('settle_tx_hash').notNull(),
    /** Set on barter-swap settlements; links the row to the on-chain `execute_swap`. */
    swapTxHash: text('swap_tx_hash'),
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
 * Barter trade proposals — the read-mirror of the contract's `SwapProposal`
 * state. The chain holds the proposer's escrowed give-side cards (and any USDC
 * sweetener); these rows make the inbox queryable with card metadata, expiry,
 * and human-readable status. The indexer reconciles status from chain events.
 */
export const tradeProposals = pgTable(
  'trade_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposer: text('proposer').notNull(),
    counterparty: text('counterparty').notNull(),
    /** Card ids (cards.id) the proposer gives — locked in contract custody. */
    giveCardIds: text('give_card_ids').array().notNull(),
    /** Card ids (cards.id) the proposer wants from the counterparty. */
    getCardIds: text('get_card_ids').array().notNull(),
    /** One-way USDC sweetener from proposer to counterparty (0 = pure card swap). */
    cashUsdc: numeric('cash_usdc', { precision: 20, scale: 7 }).notNull().default('0'),
    /** Platform fee taken on the USDC sweetener at settlement (0 until accepted). */
    feeUsdc: numeric('fee_usdc', { precision: 20, scale: 7 }).notNull().default('0'),
    status: tradeProposalStatus('status').notNull().default('proposed'),
    /** Proposal id inside the settlement contract (set once `propose_swap` confirms). */
    contractSwapId: integer('contract_swap_id'),
    /** Tx hash of the on-chain `propose_swap` call. */
    proposeTxHash: text('propose_tx_hash'),
    /** Tx hash of the on-chain `execute_swap` settlement. */
    swapTxHash: text('swap_tx_hash'),
    /** When the proposal auto-expires (7 days from creation); swept by the cron. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    proposerIdx: index('trade_proposals_proposer_idx').on(t.proposer),
    counterpartyIdx: index('trade_proposals_counterparty_idx').on(t.counterparty),
    statusExpiresIdx: index('trade_proposals_status_expires_at_idx').on(t.status, t.expiresAt),
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
export type AuctionRow = typeof auctions.$inferSelect;
export type BidRow = typeof bids.$inferSelect;
export type OfferRow = typeof offers.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type TradeProposalRow = typeof tradeProposals.$inferSelect;
export type WatchlistRow = typeof watchlist.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type UserRow = typeof users.$inferSelect;

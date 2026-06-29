/**
 * Chain indexer (task 5.5).
 *
 * The chain is the source of truth; this reconciles listing/offer status into
 * the Postgres mirror. It runs on a light interval and can be triggered
 * on-action via `reconcileNow()`. View calls are simulated (read-only, no
 * signing). The inline submit handler covers the happy path; this catches any
 * drift (e.g. actions taken outside the app).
 */

import { and, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import { MarketplaceContract, fromStroops } from '@cardmkt/shared';
import { env } from './env.js';
import { logger } from './logger.js';
import { simulateContractView, transactionCreatedId } from './stellar.js';
import { sweepAbandonedOrders } from './data/orders.js';
import { sweepAbandonedBuildRows } from './data/sweep.js';

const contract = new MarketplaceContract(env.contractId);
const { listings, offers, orders, auctions, bids, watchlist, tradeProposals, trades } = schema;

// Contract status codes -> DB enums.
const LISTING_STATUS = ['open', 'sold', 'cancelled'] as const;
const OFFER_STATUS = ['open', 'settled', 'withdrawn'] as const;
// Mirrors the contract's `ORDER_*` codes by position.
const ORDER_STATUS = ['funded', 'shipped', 'disputed', 'released', 'refunded'] as const;
// Mirrors the contract's `AUCTION_*` codes by position.
const AUCTION_STATUS = ['open', 'settled', 'cancelled', 'no_winner'] as const;
/**
 * Maps the contract's `SWAP_*` codes (10–13) to the `trade_proposals` status.
 * Note the code→status order is not positional: ACCEPTED(11)→accepted,
 * CANCELLED(12)→cancelled, DECLINED(13)→declined.
 */
const SWAP_STATUS: Record<number, 'proposed' | 'accepted' | 'cancelled' | 'declined'> = {
  10: 'proposed',
  11: 'accepted',
  12: 'cancelled',
  13: 'declined',
};


async function reconcileListings(): Promise<void> {
  const rows = await db
    .select()
    .from(listings)
    .where(and(eq(listings.status, 'open'), isNotNull(listings.contractListingId)));
  for (const row of rows) {
    const view = await simulateContractView(contract.getListingView(row.contractListingId!));
    // A definitive on-chain "missing" (entry from a prior deploy, or archived)
    // retires the phantom row; a successful read maps the contract status code.
    // An unverifiable RPC read leaves the row untouched for the next pass.
    let status: (typeof LISTING_STATUS)[number] | undefined;
    if (view.kind === 'missing') {
      status = 'cancelled';
    } else if (view.kind === 'ok') {
      status = LISTING_STATUS[Number(view.value.status ?? 0)];
    }
    if (status && status !== 'open') {
      // Close the listing and drop any watchlist rows for it in one transaction,
      // so the My-bids Watchlist never shows phantom entries for closed lots.
      await db.transaction(async (tx) => {
        await tx.update(listings).set({ status }).where(eq(listings.id, row.id));
        await tx.delete(watchlist).where(eq(watchlist.listingId, row.id));
      });
    }
  }
}

async function reconcileOffers(): Promise<void> {
  const rows = await db
    .select()
    .from(offers)
    .where(and(eq(offers.status, 'open'), isNotNull(offers.contractOfferId)));
  for (const row of rows) {
    const view = await simulateContractView(contract.getOfferView(row.contractOfferId!));
    // A definitive on-chain "missing" (prior deploy / archived entry) retires the
    // phantom offer as withdrawn; a successful read maps the contract status code.
    // An unverifiable RPC read leaves the row untouched for the next pass.
    let status: (typeof OFFER_STATUS)[number] | undefined;
    if (view.kind === 'missing') {
      status = 'withdrawn';
    } else if (view.kind === 'ok') {
      status = OFFER_STATUS[Number(view.value.status ?? 0)];
    }
    if (status && status !== 'open') {
      await db.update(offers).set({ status }).where(eq(offers.id, row.id));
    }
  }
}

async function reconcileOrders(): Promise<void> {
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.status, ['funded', 'shipped', 'disputed']),
        isNotNull(orders.contractOrderId),
      ),
    );
  for (const row of rows) {
    const view = await simulateContractView(contract.getOrderView(row.contractOrderId!));
    if (view.kind === 'unknown') continue; // transient — retry on the next pass
    if (view.kind === 'missing') {
      // Orders are never removed on-chain (always written with a terminal status),
      // so a definitive "missing" is a phantom from a prior deploy / archived
      // entry. Retire it as refunded (no settlement occurred on this deployment).
      await db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, row.id));
      continue;
    }
    const status = ORDER_STATUS[Number(view.value.status ?? 0)];
    const deadline = view.value.confirm_deadline != null ? Number(view.value.confirm_deadline) : null;
    if (status && status !== row.status) {
      await db.update(orders).set({ status }).where(eq(orders.id, row.id));
    }
    if (deadline != null && deadline !== row.confirmDeadline) {
      await db.update(orders).set({ confirmDeadline: deadline }).where(eq(orders.id, row.id));
    }
  }
}

/**
 * Reconcile open auctions against the chain: the authoritative `ends_at`
 * (extended by anti-snipe), the current high bid/bidder, and terminal status.
 * Catches drift from bids/settlements taken outside the app's submit path. The
 * `outbid_at` marking and trade insertion happen on the in-app submit path; here
 * we only mirror the displayed auction state so countdowns and prices stay live.
 */
async function reconcileAuctions(): Promise<void> {
  const rows = await db
    .select()
    .from(auctions)
    .where(and(eq(auctions.status, 'open'), isNotNull(auctions.contractAuctionId)));
  for (const row of rows) {
    const view = await simulateContractView(contract.getAuctionView(row.contractAuctionId!));
    if (view.kind === 'unknown') continue; // transient — retry on the next pass
    if (view.kind === 'missing') {
      // Entry gone on-chain (prior deploy / archived): retire the phantom auction.
      await db.update(auctions).set({ status: 'cancelled' }).where(eq(auctions.id, row.id));
      continue;
    }
    const v = view.value;
    const status = AUCTION_STATUS[Number(v.status ?? 0)];
    const highBidder = (v.high_bidder as string | undefined) ?? null;
    const highBidUsdc = v.high_bid != null ? fromStroops(BigInt(v.high_bid as never)) : '0';
    const endsAt = v.ends_at != null ? new Date(Number(v.ends_at) * 1000) : null;

    const patch: Partial<typeof auctions.$inferInsert> = {};
    if (highBidder !== row.highBidder) patch.highBidder = highBidder;
    if (highBidUsdc !== row.highBidUsdc) patch.highBidUsdc = highBidUsdc;
    if (endsAt && endsAt.getTime() !== row.endsAt.getTime()) patch.endsAt = endsAt;
    if (status && status !== 'open') patch.status = status;
    if (Object.keys(patch).length > 0) {
      await db.update(auctions).set(patch).where(eq(auctions.id, row.id));
    }
    // Mark superseded bids as outbid so the history renders correctly even when a
    // bid was placed outside the app.
    if (highBidder) {
      await db
        .update(bids)
        .set({ outbidAt: new Date() })
        .where(and(eq(bids.auctionId, row.id), ne(bids.bidder, highBidder), isNull(bids.outbidAt)));
    }
  }
}

/**
 * Write the settled `trades` row for an accepted swap, keyed by `swap_tx_hash`
 * so it's idempotent: the in-app accept path and the indexer can both call this
 * without producing duplicate rows. A swap has no listing (`listingId = null`);
 * `buyer = counterparty`, `seller = proposer`, `price = cash sweetener`.
 */
async function recordSwapTradeIfMissing(row: typeof tradeProposals.$inferSelect): Promise<void> {
  if (!row.swapTxHash) return;
  const existing = await db
    .select({ id: trades.id })
    .from(trades)
    .where(eq(trades.swapTxHash, row.swapTxHash))
    .limit(1);
  if (existing.length) return;
  await db.insert(trades).values({
    listingId: null,
    buyer: row.counterparty,
    seller: row.proposer,
    priceUsdc: row.cashUsdc,
    feeUsdc: row.feeUsdc,
    royaltyUsdc: '0',
    settleTxHash: row.swapTxHash,
    swapTxHash: row.swapTxHash,
  });
}

/**
 * Reconcile barter proposals against the chain. Mirrors terminal `SwapProposal`
 * status (accepted/declined/cancelled) for proposals the DB still shows as
 * `proposed`, and ensures every accepted proposal with a known settlement hash
 * has its `trades` row. A view carries no tx hash, so a drift-detected
 * acceptance updates status only — the in-app accept path supplies the hash and
 * the trade row.
 */
export async function reconcileSwaps(): Promise<void> {
  const pending = await db
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.status, 'proposed'), isNotNull(tradeProposals.contractSwapId)));
  for (const row of pending) {
    const view = await simulateContractView(contract.getSwapView(row.contractSwapId!));
    if (view.kind === 'unknown') continue; // transient — retry on the next pass
    if (view.kind === 'missing') {
      // Swaps are never removed on-chain (always written with a terminal status),
      // so a definitive "missing" is a phantom from a prior deploy / archived
      // entry. Retire it as cancelled (locked assets returned, no swap occurred).
      await db.update(tradeProposals).set({ status: 'cancelled' }).where(eq(tradeProposals.id, row.id));
      continue;
    }
    const status = SWAP_STATUS[Number(view.value.status ?? 0)];
    if (status && status !== 'proposed') {
      await db.update(tradeProposals).set({ status }).where(eq(tradeProposals.id, row.id));
    }
  }

  const accepted = await db
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.status, 'accepted'), isNotNull(tradeProposals.swapTxHash)));
  for (const row of accepted) {
    await recordSwapTradeIfMissing(row);
  }
}

/**
 * Sweep expired proposals (task 6.3). The contract's `cancel_swap` requires the
 * proposer's authorization, which the API cannot provide on their behalf, so the
 * sweep marks the row `expired` to remove it from the active inbox; the proposer
 * reclaims the on-chain assets via `cancel_swap` themselves (the cancel endpoint
 * accepts an expired row). See design Decision 3.
 */
async function sweepExpiredProposals(): Promise<void> {
  const expired = await db
    .update(tradeProposals)
    .set({ status: 'expired' })
    .where(and(eq(tradeProposals.status, 'proposed'), lt(tradeProposals.expiresAt, new Date())))
    .returning({ id: tradeProposals.id });
  if (expired.length) {
    logger.child({ component: 'indexer' }).info({ count: expired.length }, 'swept expired proposals');
  }
}

/**
 * Recover contract ids the submit path failed to parse. `list`/`make_offer`/
 * `purchase_escrow`/`create_auction` store their row's tx hash even when the
 * return value couldn't be read, leaving `contractXId = null` — which would
 * otherwise exclude the row from every reconciler above forever. Re-fetch the
 * settled tx by hash and backfill the id; a still-unreadable result is retried on
 * the next pass. Bounded per table so a backlog never stalls a tick.
 */
async function backfillContractIds(): Promise<void> {
  const recover = async (
    rows: { id: string; hash: string | null }[],
    apply: (rowId: string, contractId: number) => Promise<unknown>,
  ): Promise<void> => {
    await Promise.all(
      rows.map(async (r) => {
        if (!r.hash) return;
        const id = await transactionCreatedId(r.hash);
        if (id != null) await apply(r.id, id);
      }),
    );
  };

  const [listingRows, offerRows, orderRows, auctionRows] = await Promise.all([
    db
      .select({ id: listings.id, hash: listings.escrowTxHash })
      .from(listings)
      .where(and(isNull(listings.contractListingId), isNotNull(listings.escrowTxHash)))
      .limit(50),
    db
      .select({ id: offers.id, hash: offers.escrowTxHash })
      .from(offers)
      .where(and(isNull(offers.contractOfferId), isNotNull(offers.escrowTxHash)))
      .limit(50),
    db
      .select({ id: orders.id, hash: orders.escrowTxHash })
      .from(orders)
      .where(and(isNull(orders.contractOrderId), isNotNull(orders.escrowTxHash)))
      .limit(50),
    db
      .select({ id: auctions.id, hash: auctions.escrowTxHash })
      .from(auctions)
      .where(and(isNull(auctions.contractAuctionId), isNotNull(auctions.escrowTxHash)))
      .limit(50),
  ]);

  await Promise.all([
    recover(listingRows, (id, cid) =>
      db.update(listings).set({ contractListingId: cid }).where(eq(listings.id, id)),
    ),
    recover(offerRows, (id, cid) =>
      db.update(offers).set({ contractOfferId: cid }).where(eq(offers.id, id)),
    ),
    recover(orderRows, (id, cid) =>
      db.update(orders).set({ contractOrderId: cid }).where(eq(orders.id, id)),
    ),
    recover(auctionRows, (id, cid) =>
      db.update(auctions).set({ contractAuctionId: cid }).where(eq(auctions.id, id)),
    ),
  ]);
}

export async function reconcileNow(): Promise<void> {
  // Backfill missing contract ids first so rows recovered this tick are visible to
  // the reconcilers below in the same pass.
  await backfillContractIds();
  await Promise.all([
    reconcileListings(),
    reconcileOffers(),
    reconcileOrders(),
    reconcileAuctions(),
    reconcileSwaps(),
    sweepExpiredProposals(),
    // Retire build-time rows the user never submitted on-chain, so abandoned
    // checkouts don't linger in the mirror as phantom open state.
    sweepAbandonedBuildRows(),
    sweepAbandonedOrders(),
  ]);
}

/**
 * Start the periodic reconciler. Returns a stop handle that clears the interval
 * so graceful shutdown can guarantee no reconciliation runs after exit begins.
 */
export function startIndexer(intervalMs = 15_000): () => void {
  const log = logger.child({ component: 'indexer' });
  const tick = () => reconcileNow().catch((err) => log.error({ err }, 'reconcile failed'));
  tick(); // reconcile once immediately so the mirror is fresh from startup (no cold window)
  const handle = setInterval(tick, intervalMs);
  log.info({ intervalMs }, 'reconciling on interval');
  return () => clearInterval(handle);
}

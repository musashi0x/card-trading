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
import { TransactionBuilder, BASE_FEE, rpc, scValToNative, type xdr } from '@stellar/stellar-sdk';
import { db, schema } from '@cardmkt/db';
import { MarketplaceContract, fromStroops } from '@cardmkt/shared';
import { env } from './env.js';
import { logger } from './logger.js';
import { rpcServer } from './stellar.js';

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

async function readView(op: xdr.Operation): Promise<Record<string, unknown> | null> {
  try {
    const account = await rpcServer.getAccount(env.platformIssuer);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: env.stellar.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    const sim = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
      return scValToNative(sim.result.retval) as Record<string, unknown>;
    }
  } catch {
    // Best-effort reconciliation; ignore transient RPC errors.
  }
  return null;
}

async function reconcileListings(): Promise<void> {
  const rows = await db
    .select()
    .from(listings)
    .where(and(eq(listings.status, 'open'), isNotNull(listings.contractListingId)));
  for (const row of rows) {
    const view = await readView(contract.getListingView(row.contractListingId!));
    const code = Number(view?.status ?? 0);
    const status = LISTING_STATUS[code];
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
    const view = await readView(contract.getOfferView(row.contractOfferId!));
    const code = Number(view?.status ?? 0);
    const status = OFFER_STATUS[code];
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
    const view = await readView(contract.getOrderView(row.contractOrderId!));
    if (!view) continue;
    const status = ORDER_STATUS[Number(view.status ?? 0)];
    const deadline = view.confirm_deadline != null ? Number(view.confirm_deadline) : null;
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
    const view = await readView(contract.getAuctionView(row.contractAuctionId!));
    if (!view) continue;
    const status = AUCTION_STATUS[Number(view.status ?? 0)];
    const highBidder = (view.high_bidder as string | undefined) ?? null;
    const highBidUsdc = view.high_bid != null ? fromStroops(BigInt(view.high_bid as never)) : '0';
    const endsAt = view.ends_at != null ? new Date(Number(view.ends_at) * 1000) : null;

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
    const view = await readView(contract.getSwapView(row.contractSwapId!));
    if (!view) continue;
    const status = SWAP_STATUS[Number(view.status ?? 0)];
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

export async function reconcileNow(): Promise<void> {
  await Promise.all([
    reconcileListings(),
    reconcileOffers(),
    reconcileOrders(),
    reconcileAuctions(),
    reconcileSwaps(),
    sweepExpiredProposals(),
  ]);
}

/**
 * Start the periodic reconciler. Returns a stop handle that clears the interval
 * so graceful shutdown can guarantee no reconciliation runs after exit begins.
 */
export function startIndexer(intervalMs = 15_000): () => void {
  const log = logger.child({ component: 'indexer' });
  const tick = () => reconcileNow().catch((err) => log.error({ err }, 'reconcile failed'));
  const handle = setInterval(tick, intervalMs);
  log.info({ intervalMs }, 'reconciling on interval');
  return () => clearInterval(handle);
}

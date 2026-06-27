/**
 * Chain indexer (task 5.5).
 *
 * The chain is the source of truth; this reconciles listing/offer status into
 * the Postgres mirror. It runs on a light interval and can be triggered
 * on-action via `reconcileNow()`. View calls are simulated (read-only, no
 * signing). The inline submit handler covers the happy path; this catches any
 * drift (e.g. actions taken outside the app).
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { TransactionBuilder, BASE_FEE, rpc, scValToNative, type xdr } from '@stellar/stellar-sdk';
import { db, schema } from '@cardmkt/db';
import { MarketplaceContract } from '@cardmkt/shared';
import { env } from './env.js';
import { rpcServer } from './stellar.js';

const contract = new MarketplaceContract(env.contractId);
const { listings, offers, orders } = schema;

// Contract status codes -> DB enums.
const LISTING_STATUS = ['open', 'sold', 'cancelled'] as const;
const OFFER_STATUS = ['open', 'settled', 'withdrawn'] as const;
// Mirrors the contract's `ORDER_*` codes by position.
const ORDER_STATUS = ['funded', 'shipped', 'disputed', 'released', 'refunded'] as const;

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
      await db.update(listings).set({ status }).where(eq(listings.id, row.id));
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

export async function reconcileNow(): Promise<void> {
  await Promise.all([reconcileListings(), reconcileOffers(), reconcileOrders()]);
}

export function startIndexer(intervalMs = 15_000): void {
  const tick = () => reconcileNow().catch((err) => console.error('[indexer]', err.message));
  setInterval(tick, intervalMs);
  console.log(`[indexer] reconciling every ${intervalMs / 1000}s`);
}

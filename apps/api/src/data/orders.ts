import { and, eq, isNull, lt } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import { PreflightError } from '../stellar.js';

const { orders, listings, cards, cardCopies } = schema;

/** Default age before an unsubmitted `funded` order is considered abandoned. */
const ABANDONED_ORDER_TTL_MS = 15 * 60 * 1000;

function notFound(what: string): never {
  throw new PreflightError(`${what} not found`, 'NOT_FOUND');
}

/**
 * Delete abandoned escrow orders: rows pre-inserted at `purchase_escrow` build
 * time whose buyer never submitted the transaction. Such rows are `funded` with
 * no `contractOrderId` AND no `escrowTxHash` (a confirmed-but-unparsed order
 * still carries its hash, so it is preserved). Bounded by a TTL so an in-flight
 * signature is never swept.
 */
export async function sweepAbandonedOrders(ttlMs = ABANDONED_ORDER_TTL_MS): Promise<void> {
  const cutoff = new Date(Date.now() - ttlMs);
  await db
    .delete(orders)
    .where(
      and(
        eq(orders.status, 'funded'),
        isNull(orders.contractOrderId),
        isNull(orders.escrowTxHash),
        lt(orders.createdAt, cutoff),
      ),
    );
}

export async function orderWithListingCard(orderId: string) {
  const [row] = await db
    .select({ order: orders, listing: listings, card: cards, copy: cardCopies })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .innerJoin(cards, eq(listings.cardId, cards.id))
    .innerJoin(cardCopies, eq(listings.cardCopyId, cardCopies.id))
    .where(eq(orders.id, orderId));
  if (!row) notFound('Order');
  return row;
}

export async function setContractOrderId(
  orderId: string,
  contractOrderId: number | null,
  escrowTxHash: string,
): Promise<void> {
  await db
    .update(orders)
    .set({ contractOrderId, escrowTxHash })
    .where(eq(orders.id, orderId));
}

export async function markShipped(orderId: string): Promise<void> {
  await db
    .update(orders)
    .set({ status: 'shipped' })
    .where(eq(orders.id, orderId));
}

export async function markDisputed(orderId: string): Promise<void> {
  await db
    .update(orders)
    .set({ status: 'disputed' })
    .where(eq(orders.id, orderId));
}

export async function markReleased(orderId: string, settleTxHash: string): Promise<void> {
  await db
    .update(orders)
    .set({ status: 'released', settleTxHash })
    .where(eq(orders.id, orderId));
}

export async function markRefunded(orderId: string, settleTxHash: string): Promise<void> {
  await db
    .update(orders)
    .set({ status: 'refunded', settleTxHash })
    .where(eq(orders.id, orderId));
}

export async function insertOrder(values: typeof orders.$inferInsert) {
  const [order] = await db.insert(orders).values(values).returning();
  return order;
}

export async function updateTrackingRef(orderId: string, trackingRef: string): Promise<void> {
  await db
    .update(orders)
    .set({ trackingRef })
    .where(eq(orders.id, orderId));
}

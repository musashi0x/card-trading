import { eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import { PreflightError } from '../stellar.js';

const { orders, listings, cards } = schema;

function notFound(what: string): never {
  throw new PreflightError(`${what} not found`, 'NOT_FOUND');
}

export async function orderWithListingCard(orderId: string) {
  const [row] = await db
    .select({ order: orders, listing: listings, card: cards })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .innerJoin(cards, eq(listings.cardId, cards.id))
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

import { eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';

const { offers } = schema;

export async function offerLookup(offerId: string) {
  const [row] = await db
    .select()
    .from(offers)
    .where(eq(offers.id, offerId));
  return row;
}

export async function setContractOfferId(
  offerId: string,
  contractOfferId: number | null,
  escrowTxHash: string,
): Promise<void> {
  await db
    .update(offers)
    .set({ contractOfferId, escrowTxHash })
    .where(eq(offers.id, offerId));
}

export async function markSettled(offerId: string): Promise<void> {
  await db
    .update(offers)
    .set({ status: 'settled' })
    .where(eq(offers.id, offerId));
}

export async function markWithdrawn(offerId: string): Promise<void> {
  await db
    .update(offers)
    .set({ status: 'withdrawn' })
    .where(eq(offers.id, offerId));
}

export async function insertOffer(values: typeof offers.$inferInsert) {
  const [offer] = await db.insert(offers).values(values).returning();
  return offer;
}

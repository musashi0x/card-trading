import { eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import { PreflightError } from '../stellar.js';

const { listings, cards } = schema;

function notFound(what: string): never {
  throw new PreflightError(`${what} not found`, 'NOT_FOUND');
}

export async function listingWithCard(listingId: string) {
  const [row] = await db
    .select({ listing: listings, card: cards })
    .from(listings)
    .innerJoin(cards, eq(listings.cardId, cards.id))
    .where(eq(listings.id, listingId));
  if (!row) notFound('Listing');
  return row;
}

export async function markSold(listingId: string): Promise<void> {
  await db
    .update(listings)
    .set({ status: 'sold' })
    .where(eq(listings.id, listingId));
}

export async function markCancelled(listingId: string): Promise<void> {
  await db
    .update(listings)
    .set({ status: 'cancelled' })
    .where(eq(listings.id, listingId));
}

export async function setContractListingId(
  listingId: string,
  contractListingId: number | null,
  escrowTxHash: string,
): Promise<void> {
  await db
    .update(listings)
    .set({ contractListingId, escrowTxHash })
    .where(eq(listings.id, listingId));
}

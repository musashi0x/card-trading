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

/**
 * Like `listingWithCard`, but rejects a listing that is not open. Used by the
 * buy/escrow build endpoints so a buyer never signs a settlement the contract
 * will reject (the on-chain `STATUS_OPEN` guard remains the authority — this is
 * a fast-fail that saves a wasted signature and fee).
 */
export async function requireOpenListing(listingId: string) {
  const row = await listingWithCard(listingId);
  if (row.listing.status !== 'open') {
    throw new PreflightError('Listing is no longer open', 'LISTING_CLOSED', {
      status: row.listing.status,
    });
  }
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

import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';

const { listings, offers, auctions, bids, watchlist } = schema;

/** Age before an unsubmitted build-time row is considered abandoned. */
const ABANDONED_TTL_MS = 15 * 60 * 1000;

/**
 * Delete build-time rows the user never submitted on-chain. `list`, `make_offer`,
 * `create_auction`, and `place_bid` each insert a Postgres row at *build* time —
 * before the wallet signs and submits. If the user abandons the flow, the row is
 * left with no contract id and no escrow tx hash, and (for listings/offers/
 * auctions) `status='open'`, making it a phantom the catalog would otherwise show
 * as live. The chain is the source of truth: these rows never made it on-chain,
 * so removing them keeps the mirror honest. A TTL guards against sweeping a row
 * whose signature is still in flight. Mirrors {@link sweepAbandonedOrders}.
 *
 * Bids are deleted first so an abandoned auction with a stray (also-abandoned)
 * bid never trips the bids→auctions foreign key. For the same reason, watchlist
 * rows pointing at an abandoned listing are cleared before the listing itself, so
 * a watched phantom never trips the watchlist→listings foreign key.
 */
export async function sweepAbandonedBuildRows(ttlMs = ABANDONED_TTL_MS): Promise<void> {
  const cutoff = new Date(Date.now() - ttlMs);
  await db
    .delete(bids)
    .where(and(isNull(bids.escrowTxHash), lt(bids.createdAt, cutoff)));
  const abandonedListings = and(
    eq(listings.status, 'open'),
    isNull(listings.contractListingId),
    isNull(listings.escrowTxHash),
    lt(listings.createdAt, cutoff),
  );
  await db
    .delete(watchlist)
    .where(
      inArray(
        watchlist.listingId,
        db.select({ id: listings.id }).from(listings).where(abandonedListings),
      ),
    );
  await Promise.all([
    db.delete(listings).where(abandonedListings),
    db
      .delete(offers)
      .where(
        and(
          eq(offers.status, 'open'),
          isNull(offers.contractOfferId),
          isNull(offers.escrowTxHash),
          lt(offers.createdAt, cutoff),
        ),
      ),
    db
      .delete(auctions)
      .where(
        and(
          eq(auctions.status, 'open'),
          isNull(auctions.contractAuctionId),
          isNull(auctions.escrowTxHash),
          lt(auctions.createdAt, cutoff),
        ),
      ),
  ]);
}

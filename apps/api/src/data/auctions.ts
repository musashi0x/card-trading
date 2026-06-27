import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import { PreflightError } from '../stellar.js';

const { auctions, bids, cards } = schema;

function notFound(what: string): never {
  throw new PreflightError(`${what} not found`, 'NOT_FOUND');
}

/** An auction joined with its card metadata. */
export async function auctionWithCard(auctionId: string) {
  const [row] = await db
    .select({ auction: auctions, card: cards })
    .from(auctions)
    .innerJoin(cards, eq(auctions.cardId, cards.id))
    .where(eq(auctions.id, auctionId));
  if (!row) notFound('Auction');
  return row;
}

export async function auctionLookup(auctionId: string) {
  const [row] = await db.select().from(auctions).where(eq(auctions.id, auctionId));
  return row ?? null;
}

export async function bidLookup(bidId: string) {
  const [row] = await db.select().from(bids).where(eq(bids.id, bidId));
  return row ?? null;
}

/** Insert the auction row at build time (mirrors `listings` on `list`). */
export async function createAuctionRow(values: {
  cardId: string;
  seller: string;
  startPriceUsdc: string;
  reservePriceUsdc: string;
  endsAt: Date;
}) {
  const [row] = await db.insert(auctions).values({ ...values, status: 'open' }).returning();
  return row!;
}

/** Insert a bid row at build time (mirrors `offers` on `make_offer`). */
export async function createBidRow(values: {
  auctionId: string;
  bidder: string;
  amountUsdc: string;
}) {
  const [row] = await db.insert(bids).values(values).returning();
  return row!;
}

export async function setContractAuctionId(
  auctionId: string,
  contractAuctionId: number | null,
  escrowTxHash: string,
): Promise<void> {
  await db
    .update(auctions)
    .set({ contractAuctionId, escrowTxHash })
    .where(eq(auctions.id, auctionId));
}

/**
 * Reconcile a placed bid: stamp the bid's escrow hash, promote it to the
 * auction's high bid, and mark every earlier still-leading bid as outbid.
 */
export async function applyBid(
  bidId: string,
  hash: string,
): Promise<{ auctionId: string } | null> {
  const bid = await bidLookup(bidId);
  if (!bid) return null;
  await db.transaction(async (tx) => {
    await tx.update(bids).set({ escrowTxHash: hash }).where(eq(bids.id, bid.id));
    // Any prior bid from another bidder that is still leading is now outbid.
    await tx
      .update(bids)
      .set({ outbidAt: sql`now()` })
      .where(
        and(eq(bids.auctionId, bid.auctionId), ne(bids.id, bid.id), isNull(bids.outbidAt)),
      );
    await tx
      .update(auctions)
      .set({ highBidder: bid.bidder, highBidUsdc: bid.amountUsdc })
      .where(eq(auctions.id, bid.auctionId));
  });
  return { auctionId: bid.auctionId };
}

export async function markSettled(auctionId: string, hash: string): Promise<void> {
  await db
    .update(auctions)
    .set({ status: 'settled', settleTxHash: hash })
    .where(eq(auctions.id, auctionId));
}

/** Terminal close where no winner emerged (reserve unmet / no bids) or a cancel. */
export async function markClosed(
  auctionId: string,
  status: 'cancelled' | 'no_winner',
  hash: string,
): Promise<void> {
  await db
    .update(auctions)
    .set({ status, settleTxHash: hash })
    .where(eq(auctions.id, auctionId));
}

/** All bids for an auction, high bid first (the bid history view). */
export async function bidsForAuction(auctionId: string) {
  return db
    .select()
    .from(bids)
    .where(eq(bids.auctionId, auctionId))
    .orderBy(desc(bids.amountUsdc), desc(bids.createdAt));
}

/** Every bid placed by a wallet, newest first, joined with its auction + card. */
export async function bidsForBidder(bidder: string) {
  return db
    .select({ bid: bids, auction: auctions, card: cards })
    .from(bids)
    .innerJoin(auctions, eq(bids.auctionId, auctions.id))
    .innerJoin(cards, eq(auctions.cardId, cards.id))
    .where(eq(bids.bidder, bidder))
    .orderBy(desc(bids.createdAt));
}

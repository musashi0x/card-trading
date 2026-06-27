import { db, schema } from '@cardmkt/db';
import { env } from '../env.js';

const { trades } = schema;

export function feeFor(amount: string): string {
  return ((Number(amount) * env.feeBps) / 10_000).toFixed(7);
}

/**
 * Creator royalty for a settlement, mirroring the contract: none on a primary
 * sale (seller is the creator) or for a card without a registered royalty.
 */
export function royaltyFor(
  amount: string,
  card: { royaltyBps: number; creatorAccount: string | null },
  seller: string,
): string {
  if (!card.royaltyBps || !card.creatorAccount || card.creatorAccount === seller) {
    return '0.0000000';
  }
  return ((Number(amount) * card.royaltyBps) / 10_000).toFixed(7);
}

export async function recordTrade(
  row: {
    listing: { id: string; seller: string; priceUsdc: string };
    card: { royaltyBps: number; creatorAccount: string | null };
  },
  { buyer, hash, priceUsdc }: { buyer: string; hash: string; priceUsdc?: string },
): Promise<void> {
  const price = priceUsdc ?? row.listing.priceUsdc;
  await db.insert(trades).values({
    listingId: row.listing.id,
    buyer,
    seller: row.listing.seller,
    priceUsdc: price,
    feeUsdc: feeFor(price),
    royaltyUsdc: royaltyFor(price, row.card, row.listing.seller),
    settleTxHash: hash,
  });
}

/**
 * Record the settlement of a won auction as a trade row. Auctions have no
 * listing, so `listingId` is null; price is the winning high bid.
 */
export async function recordAuctionTrade(
  auction: { seller: string; highBidder: string | null; highBidUsdc: string },
  card: { royaltyBps: number; creatorAccount: string | null },
  hash: string,
): Promise<void> {
  if (!auction.highBidder) return;
  await db.insert(trades).values({
    listingId: null,
    buyer: auction.highBidder,
    seller: auction.seller,
    priceUsdc: auction.highBidUsdc,
    feeUsdc: feeFor(auction.highBidUsdc),
    royaltyUsdc: royaltyFor(auction.highBidUsdc, card, auction.seller),
    settleTxHash: hash,
  });
}

/** Record the settlement of a released escrow order as a trade row. */
export async function recordOrderTrade(
  order: { listingId: string; buyer: string; seller: string; amountUsdc: string },
  card: { royaltyBps: number; creatorAccount: string | null },
  hash: string,
): Promise<void> {
  await db.insert(trades).values({
    listingId: order.listingId,
    buyer: order.buyer,
    seller: order.seller,
    priceUsdc: order.amountUsdc,
    feeUsdc: feeFor(order.amountUsdc),
    royaltyUsdc: royaltyFor(order.amountUsdc, card, order.seller),
    settleTxHash: hash,
  });
}

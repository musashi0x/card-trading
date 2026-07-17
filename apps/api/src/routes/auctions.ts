/**
 * Auction state + bid history, served from the Postgres read-mirror.
 *
 * Open auctions are browseable alongside fixed-price listings; each auction
 * carries its live countdown (`endsAt`), current high bid, start/reserve price,
 * and joined card metadata. Bid history is paginated, high bid first.
 */

import { Router } from 'express';
import { count, desc, eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import type {
  Auction,
  AuctionListResponse,
  Bid,
  BidListResponse,
  Card,
  CardCopy,
  MyBidsResponse,
} from '@cardmkt/shared';

export const auctionsRouter: Router = Router();

const { auctions, bids, cards, cardCopies } = schema;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuctionRow = typeof auctions.$inferSelect;
type BidRow = typeof bids.$inferSelect;
type CardRow = typeof cards.$inferSelect;
type CardCopyRow = typeof cardCopies.$inferSelect;

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    name: row.name,
    set: row.set,
    rarity: row.rarity,
    imageUrl: row.imageUrl,
    supply: row.supply,
    creatorAccount: row.creatorAccount,
    royaltyBps: row.royaltyBps,
  };
}

function toCardCopy(row: CardCopyRow): CardCopy {
  return {
    id: row.id,
    cardId: row.cardId,
    tokenId: row.tokenId,
    serial: row.serial,
    owner: row.owner,
  };
}

function toAuction(row: AuctionRow, card?: CardRow, copy?: CardCopyRow): Auction {
  return {
    id: row.id,
    cardId: row.cardId,
    card: card ? toCard(card) : undefined,
    cardCopyId: row.cardCopyId,
    copy: copy ? toCardCopy(copy) : undefined,
    contractAuctionId: row.contractAuctionId,
    seller: row.seller,
    startPriceUsdc: row.startPriceUsdc,
    reservePriceUsdc: row.reservePriceUsdc,
    endsAt: row.endsAt.toISOString(),
    highBidder: row.highBidder,
    highBidUsdc: row.highBidUsdc,
    status: row.status,
    escrowTxHash: row.escrowTxHash,
    settleTxHash: row.settleTxHash,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBid(row: BidRow): Bid {
  return {
    id: row.id,
    auctionId: row.auctionId,
    bidder: row.bidder,
    amountUsdc: row.amountUsdc,
    escrowTxHash: row.escrowTxHash,
    refundTxHash: row.refundTxHash,
    outbidAt: row.outbidAt ? row.outbidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /api/auctions[?status=open] — open auctions for the catalog, with card metadata.
auctionsRouter.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'open';
    const rows = await db
      .select({ auction: auctions, card: cards, copy: cardCopies })
      .from(auctions)
      .innerJoin(cards, eq(auctions.cardId, cards.id))
      .innerJoin(cardCopies, eq(auctions.cardCopyId, cardCopies.id))
      .where(eq(auctions.status, status as AuctionRow['status']))
      .orderBy(desc(auctions.createdAt));
    const body: AuctionListResponse = {
      auctions: rows.map((r) => toAuction(r.auction, r.card, r.copy)),
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /api/auctions/bids?bidder=G… — every bid a wallet placed, with auction state.
// Declared before `/:auctionId` so "bids" is never parsed as an auction id.
auctionsRouter.get('/bids', async (req, res, next) => {
  try {
    const bidder = typeof req.query.bidder === 'string' ? req.query.bidder.trim() : '';
    if (!STELLAR_ADDRESS.test(bidder)) {
      res.status(400).json({ error: 'Invalid bidder address', code: 'INVALID_BIDDER' });
      return;
    }
    const rows = await db
      .select({ bid: bids, auction: auctions, card: cards, copy: cardCopies })
      .from(bids)
      .innerJoin(auctions, eq(bids.auctionId, auctions.id))
      .innerJoin(cards, eq(auctions.cardId, cards.id))
      .innerJoin(cardCopies, eq(auctions.cardCopyId, cardCopies.id))
      .where(eq(bids.bidder, bidder))
      .orderBy(desc(bids.createdAt));
    const body: MyBidsResponse = {
      bids: rows.map((r) => ({
        ...toBid(r.bid),
        auction: toAuction(r.auction, r.card, r.copy),
        isHighBidder: r.auction.highBidder === bidder,
      })),
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /api/auctions/:auctionId — a single auction with card metadata.
auctionsRouter.get('/:auctionId', async (req, res, next) => {
  try {
    const { auctionId } = req.params;
    if (!UUID.test(auctionId)) {
      res.status(400).json({ error: 'Invalid auction id', code: 'INVALID_ID' });
      return;
    }
    const [row] = await db
      .select({ auction: auctions, card: cards, copy: cardCopies })
      .from(auctions)
      .innerJoin(cards, eq(auctions.cardId, cards.id))
      .innerJoin(cardCopies, eq(auctions.cardCopyId, cardCopies.id))
      .where(eq(auctions.id, auctionId));
    if (!row) {
      res.status(404).json({ error: 'Auction not found', code: 'NOT_FOUND' });
      return;
    }
    res.json(toAuction(row.auction, row.card, row.copy));
  } catch (err) {
    next(err);
  }
});

// GET /api/auctions/:auctionId/bids?limit=&offset= — paginated bid history, high bid first.
auctionsRouter.get('/:auctionId/bids', async (req, res, next) => {
  try {
    const { auctionId } = req.params;
    if (!UUID.test(auctionId)) {
      res.status(400).json({ error: 'Invalid auction id', code: 'INVALID_ID' });
      return;
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = await db
      .select()
      .from(bids)
      .where(eq(bids.auctionId, auctionId))
      .orderBy(desc(bids.amountUsdc), desc(bids.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(bids)
      .where(eq(bids.auctionId, auctionId));
    const body: BidListResponse = { bids: rows.map(toBid), total: Number(total) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

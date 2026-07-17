/**
 * Tests for the leaderboard route + its aggregation SQL.
 *
 * The aggregations live entirely in Postgres (GROUP BY / window functions), so
 * they are exercised against a real throwaway database (`cardmkt_test`,
 * provisioned in `test/global-setup.ts`) seeded per-test. Pure helpers
 * (`formatRoi`) and the in-process cache are tested directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import express from 'express';
import request from 'supertest';
import { db, schema } from '@cardmkt/db';
import {
  boardCache,
  computeBoardRows,
  formatRoi,
  getBoardRows,
  leaderboardRouter,
} from './leaderboard.js';

const { cards, cardCopies, listings, trades, offers, reviews } = schema;

// --- seeding helpers -------------------------------------------------------

let cardSeq = 0;
async function makeCard(): Promise<string> {
  cardSeq += 1;
  const [row] = await db
    .insert(cards)
    .values({
      name: `Card ${cardSeq}`,
      set: 'Base',
      rarity: 'rare',
      imageUrl: 'http://img/x.png',
    })
    .returning({ id: cards.id });
  return row!.id;
}

let tokenSeq = 0;
const serialByCard = new Map<string, number>();
async function makeCardCopy(cardId: string, owner: string): Promise<string> {
  tokenSeq += 1;
  const serial = (serialByCard.get(cardId) ?? 0) + 1;
  serialByCard.set(cardId, serial);
  const [row] = await db
    .insert(cardCopies)
    .values({ cardId, tokenId: tokenSeq, serial, owner })
    .returning({ id: cardCopies.id });
  return row!.id;
}

async function makeListing(cardId: string, seller: string, price = '0'): Promise<string> {
  const cardCopyId = await makeCardCopy(cardId, seller);
  const [row] = await db
    .insert(listings)
    .values({ cardId, cardCopyId, seller, priceUsdc: price })
    .returning({ id: listings.id });
  return row!.id;
}

/** Settle a trade; creates a card + listing for it unless `cardId` is supplied. */
async function makeTrade(args: {
  buyer: string;
  seller: string;
  price: string;
  fee?: string;
  royalty?: string;
  settledAt: Date;
  cardId?: string;
}): Promise<void> {
  const cardId = args.cardId ?? (await makeCard());
  const listingId = await makeListing(cardId, args.seller, args.price);
  await db.insert(trades).values({
    listingId,
    buyer: args.buyer,
    seller: args.seller,
    priceUsdc: args.price,
    feeUsdc: args.fee ?? '0',
    royaltyUsdc: args.royalty ?? '0',
    settleTxHash: `tx-${listingId}`,
    settledAt: args.settledAt,
  });
}

async function makeOffers(buyer: string, count: number): Promise<void> {
  const cardId = await makeCard();
  const listingId = await makeListing(cardId, 'GSELLER', '10');
  for (let i = 0; i < count; i++) {
    await db.insert(offers).values({ listingId, buyer, amountUsdc: '10' });
  }
}

async function makeReview(reviewee: string, rating: number, reviewer = 'GREVIEWER'): Promise<void> {
  await db.insert(reviews).values({ reviewerAddress: reviewer, revieweeAddress: reviewee, rating });
}

async function truncateAll(): Promise<void> {
  // CASCADE clears the FK-dependent rows (trades, offers, reviews, …) too.
  await db.execute(
    sql`TRUNCATE cards, card_copies, listings, trades, offers, reviews, watchlist, orders RESTART IDENTITY CASCADE`,
  );
}

const thisYear = new Date();
const lastYear = new Date(new Date().getFullYear() - 1, 5, 1);
const within90 = new Date();
const before90 = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  boardCache.clear();
  await truncateAll();
});

// =====================================================================
// formatRoi (pure)
// =====================================================================
describe('formatRoi', () => {
  it('formats a profit with a leading +', () => {
    expect(formatRoi(50, 100)).toBe('+50.0%');
  });

  it('formats a loss with a true minus sign (U+2212)', () => {
    expect(formatRoi(-12.3, 100)).toBe('−12.3%');
  });

  it('returns null when there is no buy cost', () => {
    expect(formatRoi(80, 0)).toBeNull();
  });
});

// =====================================================================
// 5.1 Collectors aggregation
// =====================================================================
describe('collectors board', () => {
  it('filters to the current season and values only net-held cards', async () => {
    const held = await makeCard();
    // U1: holds `held` (buy this year), and a separate card bought then resold (net 0).
    await makeTrade({ buyer: 'U1', seller: 'GX', price: '100', settledAt: thisYear, cardId: held });
    const flipped = await makeCard();
    await makeTrade({ buyer: 'U1', seller: 'GX', price: '50', settledAt: thisYear, cardId: flipped });
    await makeTrade({ buyer: 'GY', seller: 'U1', price: '60', settledAt: thisYear, cardId: flipped });
    // U1 made 4 offers → win rate = round(2 buys / 4 offers * 100) = 50.
    await makeOffers('U1', 4);
    // U2: only a prior-year buy → excluded from the season board.
    await makeTrade({ buyer: 'U2', seller: 'GX', price: '999', settledAt: lastYear });

    const rows = await computeBoardRows('collectors', 50, false);
    const u1 = rows.find((r) => r.stellarAddress === 'U1');
    expect(u1).toBeDefined();
    // Only the held card contributes; the flipped card (net 0) does not.
    expect(u1!.collectionValue).toBe('100.0000000');
    expect(u1!.cardsHeld).toBe(1);
    expect(u1!.winRate).toBe(50);
    // The prior-year-only collector never appears.
    expect(rows.some((r) => r.stellarAddress === 'U2')).toBe(false);
  });
});

// =====================================================================
// 5.2 Sellers aggregation
// =====================================================================
describe('sellers board', () => {
  beforeEach(async () => {
    // S1: two in-window sells (vol 300) + one outside the window (ignored).
    await makeTrade({ buyer: 'GB', seller: 'S1', price: '100', settledAt: within90 });
    await makeTrade({ buyer: 'GB', seller: 'S1', price: '200', settledAt: within90 });
    await makeTrade({ buyer: 'GB', seller: 'S1', price: '500', settledAt: before90 });
    await makeReview('S1', 4);
    await makeReview('S1', 5);
  });

  it('sums the trailing-90-day volume and averages ratings when available', async () => {
    const rows = await computeBoardRows('sellers', 50, true);
    const s1 = rows.find((r) => r.stellarAddress === 'S1')!;
    expect(s1.salesVolume90d).toBe('300.0000000'); // 500 sale excluded
    expect(s1.salesCount).toBe(2);
    expect(s1.avgRating).toBe(4.5);
  });

  it('degrades to null ratings but stays ranked when reviews are unavailable', async () => {
    const rows = await computeBoardRows('sellers', 50, false);
    const s1 = rows.find((r) => r.stellarAddress === 'S1')!;
    expect(s1.salesVolume90d).toBe('300.0000000');
    expect(s1.salesCount).toBe(2);
    expect(s1.avgRating).toBeNull();
  });
});

// =====================================================================
// 5.3 Traders aggregation
// =====================================================================
describe('traders board', () => {
  it('computes realized profit, flips, and signed ROI (and null ROI with no buys)', async () => {
    // MM is the minted-in market maker that sources cards to T1/T3. Every sell-side
    // counterparty is itself a trader, so MM (200 proceeds, no buys) tops the board.
    // T1: buy 100 → sell 150 (same card) = +50 profit, 1 flip, +50% ROI.
    const cardT1 = await makeCard();
    await makeTrade({ buyer: 'T1', seller: 'MM', price: '100', settledAt: thisYear, cardId: cardT1 });
    await makeTrade({ buyer: 'GY', seller: 'T1', price: '150', settledAt: thisYear, cardId: cardT1 });
    // T2: sell only (minted in), no buys → profit 80, ROI null, 0 flips.
    await makeTrade({ buyer: 'GY', seller: 'T2', price: '80', settledAt: thisYear });
    // T3: buy 100 → sell 40 = −60 profit, ROI −60%.
    const cardT3 = await makeCard();
    await makeTrade({ buyer: 'T3', seller: 'MM', price: '100', settledAt: thisYear, cardId: cardT3 });
    await makeTrade({ buyer: 'GY', seller: 'T3', price: '40', settledAt: thisYear, cardId: cardT3 });

    const rows = await computeBoardRows('traders', 50, false);
    const get = (addr: string) => rows.find((r) => r.stellarAddress === addr)!;

    expect(get('T1').realizedProfit).toBe('50.0000000');
    expect(get('T1').roi).toBe('+50.0%');
    expect(get('T1').flipCount).toBe(1);

    expect(get('T2').realizedProfit).toBe('80.0000000');
    expect(get('T2').roi).toBeNull(); // no buy history
    expect(get('T2').flipCount).toBe(0);

    expect(get('T3').realizedProfit).toBe('-60.0000000');
    expect(get('T3').roi).toBe('−60.0%'); // net loss, true minus sign
    expect(get('T3').flipCount).toBe(1);

    // GY only ever buys → never qualifies for the traders board.
    expect(rows.some((r) => r.stellarAddress === 'GY')).toBe(false);
    // Ranked by realized profit descending: MM (200) > T2 (80) > T1 (50) > T3 (−60).
    expect(rows.map((r) => r.stellarAddress)).toEqual(['MM', 'T2', 'T1', 'T3']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

// =====================================================================
// 5.4 Route integration (GET /api/leaderboard)
// =====================================================================
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/leaderboard', leaderboardRouter);
  // Mirror the production ZodError → 400 VALIDATION mapping.
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const where = first?.path.join('.');
        res.status(400).json({
          error: first ? (where ? `${where}: ${first.message}` : first.message) : 'Invalid request',
          code: 'VALIDATION',
        });
        return;
      }
      res.status(500).json({ error: err.message, code: 'INTERNAL' });
    },
  );
  return app;
}

describe('GET /api/leaderboard', () => {
  it('400 VALIDATION when board is missing', async () => {
    const res = await request(makeApp()).get('/api/leaderboard');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('200 with the response shape and ownStanding null when account is omitted', async () => {
    await makeTrade({ buyer: 'GY', seller: 'T1', price: '80', settledAt: thisYear });
    const res = await request(makeApp()).get('/api/leaderboard?board=traders');
    expect(res.status).toBe(200);
    expect(res.body.board).toBe('traders');
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.ownStanding).toBeNull();
    expect(res.body.ratingAvailable).toBeNull(); // not a sellers board
    expect(typeof res.body.cachedAt).toBe('string');
  });

  it('returns the requesting account own standing when account is provided', async () => {
    // MM (the minted-in seller, 100 proceeds, no buys) ranks #1; T1 (+50) is #2.
    const cardT1 = await makeCard();
    await makeTrade({ buyer: 'T1', seller: 'MM', price: '100', settledAt: thisYear, cardId: cardT1 });
    await makeTrade({ buyer: 'GY', seller: 'T1', price: '150', settledAt: thisYear, cardId: cardT1 });

    const res = await request(makeApp()).get('/api/leaderboard?board=traders&account=T1');
    expect(res.status).toBe(200);
    expect(res.body.ownStanding).not.toBeNull();
    expect(res.body.ownStanding.stellarAddress).toBe('T1');
    expect(res.body.ownStanding.rank).toBe(2);
    expect(res.body.ownStanding.realizedProfit).toBe('50.0000000');
  });

  it('reports rank null with zeroed metrics for an account with no board activity', async () => {
    await makeTrade({ buyer: 'GY', seller: 'T1', price: '80', settledAt: thisYear });
    const res = await request(makeApp()).get('/api/leaderboard?board=traders&account=GHOST');
    expect(res.status).toBe(200);
    expect(res.body.ownStanding.rank).toBeNull();
    expect(res.body.ownStanding.realizedProfit).toBe('0');
  });
});

// =====================================================================
// 5.5 In-process cache
// =====================================================================
describe('board cache', () => {
  afterEach(() => vi.restoreAllMocks());

  it('serves cached board rows without re-querying within the TTL', async () => {
    await makeTrade({ buyer: 'U1', seller: 'GX', price: '100', settledAt: thisYear });
    const spy = vi.spyOn(db, 'execute');

    const first = await getBoardRows('collectors', 10, false);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await getBoardRows('collectors', 10, false);
    // No additional query was issued for the cache hit.
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    expect(second.rows).toEqual(first.rows);
  });
});

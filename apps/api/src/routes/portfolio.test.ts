/**
 * Tests for the portfolio-valuation route + its pure helpers.
 *
 * The valuation/cost-basis/history helpers are exercised directly (no I/O). The
 * route is tested via supertest against a throwaway Express app, with the DB
 * mocked so no Postgres is touched. Holdings are resolved from the
 * `card_copies.owner` mirror, so ownership is faked by seeding the `cardCopies`
 * dataset with `{ cardId }` rows for the account under test.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- mocks: drizzle helpers + the DB ---

// Shared state for the mocks. `vi.hoisted` runs before the hoisted `vi.mock`
// factories, so they can safely reference these. Sentinel table objects let the
// fake query builder key its dataset off whichever one `.from()` receives.
const h = vi.hoisted(() => ({
  cards: { __table: 'cards' } as object,
  cardCopies: { __table: 'cardCopies' } as object,
  listings: { __table: 'listings' } as object,
  trades: { __table: 'trades' } as object,
  datasets: new Map<unknown, unknown[]>(),
}));

// The route imports `eq` only; make it a no-op so column-less sentinel tables
// don't blow up. (`@cardmkt/db` is fully mocked below, so its own drizzle use is
// unaffected.)
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

vi.mock('@cardmkt/db', () => {
  function fakeBuilder() {
    let rows: unknown[] = [];
    const builder: Record<string, unknown> = {
      from(table: unknown) {
        rows = h.datasets.get(table) ?? [];
        return builder;
      },
      where: () => builder,
      innerJoin: () => builder,
      then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(res, rej),
      catch: (rej: (e: unknown) => unknown) => Promise.resolve(rows).catch(rej),
      finally: (f: () => void) => Promise.resolve(rows).finally(f),
    };
    return builder;
  }
  return {
    db: { select: () => fakeBuilder() },
    schema: { cards: h.cards, cardCopies: h.cardCopies, listings: h.listings, trades: h.trades },
  };
});

const { cards, cardCopies, listings, trades, datasets } = h;

import express from 'express';
import request from 'supertest';
import {
  portfolioRouter,
  valuateCard,
  costBasisFor,
  buildHistory,
  monthEndsEndingAt,
  monthKey,
  type ValuationTrade,
  type ValuationListing,
  type HistoryCardData,
} from './portfolio.js';

const ACCOUNT = 'G' + 'A'.repeat(55); // valid Stellar-shaped address for tests
const d = (s: string) => new Date(s);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/portfolio', portfolioRouter);
  return app;
}

beforeEach(() => {
  datasets.clear();
});

// =====================================================================
// 6.1 Valuation waterfall
// =====================================================================
describe('valuateCard (waterfall)', () => {
  it('uses the most recent trade price over any listing price', () => {
    const cardTrades: ValuationTrade[] = [
      { priceUsdc: '100', settledAt: d('2024-01-10') },
      { priceUsdc: '150', settledAt: d('2024-03-10') }, // newest wins
    ];
    const cardListings: ValuationListing[] = [{ priceUsdc: '999', createdAt: d('2024-04-01') }];
    expect(valuateCard(cardTrades, cardListings)).toEqual({ value: 150, valuedAt: 'trade' });
  });

  it('falls back to the lowest open listing price when there are no trades', () => {
    const cardListings: ValuationListing[] = [
      { priceUsdc: '80', createdAt: d('2024-02-01') },
      { priceUsdc: '60', createdAt: d('2024-02-02') }, // cheapest wins
    ];
    expect(valuateCard([], cardListings)).toEqual({ value: 60, valuedAt: 'listing' });
  });

  it('returns zero with a null sentinel when neither trades nor listings exist', () => {
    expect(valuateCard([], [])).toEqual({ value: 0, valuedAt: null });
  });

  it('respects the asOf cutoff for historical valuation', () => {
    const cardTrades: ValuationTrade[] = [{ priceUsdc: '150', settledAt: d('2024-03-10') }];
    const cardListings: ValuationListing[] = [{ priceUsdc: '60', createdAt: d('2024-01-01') }];
    // As of Feb, the March trade is invisible — fall through to the Jan listing.
    expect(valuateCard(cardTrades, cardListings, d('2024-02-15'))).toEqual({
      value: 60,
      valuedAt: 'listing',
    });
  });
});

// =====================================================================
// 6.2 Cost-basis lookup
// =====================================================================
describe('costBasisFor', () => {
  it('uses the most recent purchase trade', () => {
    const purchases: ValuationTrade[] = [
      { priceUsdc: '100', settledAt: d('2024-01-01') },
      { priceUsdc: '120', settledAt: d('2024-05-01') }, // latest purchase
    ];
    expect(costBasisFor(purchases)).toEqual({ costBasis: 120, costBasisKnown: true });
  });

  it('reports costBasisKnown=false when no purchase trade exists', () => {
    expect(costBasisFor([])).toEqual({ costBasis: 0, costBasisKnown: false });
  });
});

// =====================================================================
// 6.3 12-month history synthesis
// =====================================================================
describe('buildHistory', () => {
  const monthEnds = monthEndsEndingAt(new Date('2024-06-15T00:00:00Z'));

  it('returns 12 oldest-first entries with the current month set to the live total', () => {
    const history = buildHistory({ monthEnds, cardData: new Map(), buys: [], sells: [], liveTotal: 42 });
    expect(history).toHaveLength(12);
    expect(history[11]).toEqual({ month: monthKey(monthEnds[11]!), value: 42 });
    expect(history[11]!.month).toBe('2024-06');
  });

  it('zeroes months before any purchase and values held cards at month-end data', () => {
    const cardData = new Map<string, HistoryCardData>([
      ['c1', { trades: [{ priceUsdc: '200', settledAt: d('2024-03-20') }], listings: [] }],
    ]);
    const buys = [{ cardId: 'c1', settledAt: d('2024-03-20') }];
    const history = buildHistory({ monthEnds, cardData, buys, sells: [], liveTotal: 200 });

    // Jan/Feb (indices 7,8 are Mar..; compute by month key) are before the buy → 0.
    const byMonth = Object.fromEntries(history.map((h) => [h.month, h.value]));
    expect(byMonth['2024-01']).toBe(0);
    expect(byMonth['2024-02']).toBe(0);
    // March onward holds c1, valued at its trade price.
    expect(byMonth['2024-03']).toBe(200);
    expect(byMonth['2024-05']).toBe(200);
    // Current month equals the live total verbatim.
    expect(byMonth['2024-06']).toBe(200);
  });

  it('drops a card from the held set once it is sold', () => {
    const cardData = new Map<string, HistoryCardData>([
      ['c1', { trades: [{ priceUsdc: '200', settledAt: d('2024-02-01') }], listings: [] }],
    ]);
    const buys = [{ cardId: 'c1', settledAt: d('2024-02-01') }];
    const sells = [{ cardId: 'c1', settledAt: d('2024-04-01') }];
    const history = buildHistory({ monthEnds, cardData, buys, sells, liveTotal: 0 });
    const byMonth = Object.fromEntries(history.map((h) => [h.month, h.value]));
    expect(byMonth['2024-03']).toBe(200); // held
    expect(byMonth['2024-05']).toBe(0); // sold in April, gone by May
  });
});

// =====================================================================
// 6.4 Route-level (GET /api/portfolio)
// =====================================================================
describe('GET /api/portfolio', () => {
  it('400 INVALID_ACCOUNT for a bad address, without touching the chain', async () => {
    const res = await request(makeApp()).get('/api/portfolio?account=not-a-real-address');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ACCOUNT');
  });

  it('200 with an empty portfolio for an account that holds nothing', async () => {
    datasets.set(cards, []);
    datasets.set(cardCopies, []);
    datasets.set(listings, []);
    datasets.set(trades, []);

    const res = await request(makeApp()).get(`/api/portfolio?account=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(res.body.holdings).toEqual([]);
    expect(res.body.totalValue).toBe('0.0000000');
    expect(res.body.unrealizedGainPct).toBeNull();
    expect(res.body.history).toHaveLength(12);
    expect(res.body.history.every((h: { value: string }) => h.value === '0.0000000')).toBe(true);
  });

  it('200 with the correct shape for a seeded account with holdings', async () => {
    const c1 = { id: 'c1', name: 'Solar Drake', rarity: 'legendary', imageUrl: 'x' };
    datasets.set(cards, [c1]);
    datasets.set(cardCopies, [{ cardId: 'c1' }]);
    datasets.set(listings, []);
    datasets.set(trades, [
      // account bought c1 at 100; a later third-party trade marks the market at 150.
      { cardId: 'c1', buyer: ACCOUNT, seller: 'GSELLER', priceUsdc: '100', settledAt: d('2024-03-01') },
      { cardId: 'c1', buyer: 'GOTHER', seller: 'GSOMEONE', priceUsdc: '150', settledAt: d('2024-05-01') },
    ]);

    const res = await request(makeApp()).get(`/api/portfolio?account=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(res.body.holdings).toHaveLength(1);
    const h = res.body.holdings[0];
    expect(h).toMatchObject({
      cardId: 'c1',
      name: 'Solar Drake',
      value: '150.0000000',
      valuedAt: 'trade',
      costBasis: '100.0000000',
      costBasisKnown: true,
      listed: false,
    });
    expect(res.body.totalValue).toBe('150.0000000');
    expect(res.body.totalCost).toBe('100.0000000');
    expect(res.body.unrealizedGain).toBe('50.0000000');
    expect(res.body.rarity).toEqual([{ rarity: 'legendary', value: '150.0000000', pct: 100 }]);
    expect(res.body.history[11].value).toBe('150.0000000');
  });
});

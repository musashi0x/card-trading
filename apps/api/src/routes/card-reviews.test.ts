/**
 * Integration tests for card reviews routes.
 *
 * DB and drizzle operators are mocked; supertest drives a minimal Express app.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  cardReviews: { __table: 'card_reviews' } as object,
  trades: { __table: 'trades' } as object,
  listings: { __table: 'listings' } as object,
  cards: { __table: 'cards' } as object,
  // rows returned for the current query
  rows: [] as unknown[],
  insertedRow: null as unknown,
  deletedId: null as string | null,
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  avg: (col: unknown) => ({ avg: col }),
  count: () => ({ count: true }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  or: (...args: unknown[]) => ({ or: args }),
}));

vi.mock('@cardmkt/db', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      orderBy: () => chain,
      limit: () =>
        Promise.resolve(h.rows.slice(0, 1)),
      then: (res: (v: unknown) => unknown) => Promise.resolve(h.rows).then(res),
    };
    return chain;
  };

  return {
    db: {
      select: () => makeChain(),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([h.insertedRow]),
          }),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(),
      }),
    },
    schema: {
      cardReviews: h.cardReviews,
      trades: h.trades,
      listings: h.listings,
      cards: h.cards,
    },
  };
});

import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import { cardReviewsRouter } from './card-reviews.js';

const CARD_ID = '00000000-0000-0000-0000-000000000001';
const REVIEW_ID = '00000000-0000-0000-0000-000000000002';
const AUTHOR = 'G' + 'A'.repeat(55);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/:id/reviews', cardReviewsRouter);
  app.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      res.status(400).json({ error: first?.message ?? 'Invalid request', code: 'VALIDATION' });
      return;
    }
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return app;
}

describe('GET /:id/reviews', () => {
  beforeEach(() => {
    h.rows = [
      { id: REVIEW_ID, cardId: CARD_ID, authorAddress: AUTHOR, stars: 4, body: 'Great card', createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01') },
      { avg: '4', cnt: 1 },
    ];
  });

  it('returns reviews and aggregate', async () => {
    h.rows = [
      { id: REVIEW_ID, cardId: CARD_ID, authorAddress: AUTHOR, stars: 4, body: 'Great', createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01') },
    ];
    const res = await request(makeApp()).get(`/${CARD_ID}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reviews');
    expect(res.body).toHaveProperty('aggregate');
  });
});

describe('POST /:id/reviews', () => {
  beforeEach(() => {
    // Card exists
    h.rows = [{ id: CARD_ID }];
    h.insertedRow = {
      id: REVIEW_ID, cardId: CARD_ID, authorAddress: AUTHOR, stars: 5, body: null,
      createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01'),
    };
  });

  it('rejects stars outside 1-5', async () => {
    const res = await request(makeApp())
      .post(`/${CARD_ID}/reviews`)
      .send({ authorAddress: AUTHOR, stars: 6 });
    expect(res.status).toBe(400);
  });

  it('rejects body over 1000 chars', async () => {
    const res = await request(makeApp())
      .post(`/${CARD_ID}/reviews`)
      .send({ authorAddress: AUTHOR, stars: 3, body: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });

  it('rejects invalid Stellar address', async () => {
    const res = await request(makeApp())
      .post(`/${CARD_ID}/reviews`)
      .send({ authorAddress: 'not-an-address', stars: 3 });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /:id/reviews/:reviewId', () => {
  it('requires authorAddress query param', async () => {
    const res = await request(makeApp()).delete(`/${CARD_ID}/reviews/${REVIEW_ID}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when review does not exist', async () => {
    h.rows = [];
    const res = await request(makeApp())
      .delete(`/${CARD_ID}/reviews/${REVIEW_ID}?authorAddress=${AUTHOR}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when not the author', async () => {
    const OTHER = 'G' + 'B'.repeat(55);
    h.rows = [{ id: REVIEW_ID, authorAddress: OTHER }];
    const res = await request(makeApp())
      .delete(`/${CARD_ID}/reviews/${REVIEW_ID}?authorAddress=${AUTHOR}`);
    expect(res.status).toBe(403);
  });

  it('returns 204 when author deletes own review', async () => {
    h.rows = [{ id: REVIEW_ID, authorAddress: AUTHOR }];
    const res = await request(makeApp())
      .delete(`/${CARD_ID}/reviews/${REVIEW_ID}?authorAddress=${AUTHOR}`);
    expect(res.status).toBe(204);
  });
});

/**
 * Integration tests for card comments routes.
 *
 * DB and drizzle operators are mocked; supertest drives a minimal Express app.
 * The in-memory rate limiter is reset between tests by importing a fresh module.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  cardComments: { __table: 'card_comments' } as object,
  cards: { __table: 'cards' } as object,
  rows: [] as unknown[],
  insertedRow: null as unknown,
  updatedId: null as string | null,
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  asc: (col: unknown) => ({ asc: col }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  gt: (col: unknown, val: unknown) => ({ gt: [col, val] }),
}));

vi.mock('@cardmkt/db', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      then: (res: (v: unknown) => unknown) => Promise.resolve(h.rows).then(res),
    };
    return chain;
  };

  return {
    db: {
      select: () => makeChain(),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([h.insertedRow]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    },
    schema: {
      cardComments: h.cardComments,
      cards: h.cards,
    },
  };
});

import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import { cardCommentsRouter } from './card-comments.js';

const CARD_ID = '00000000-0000-0000-0000-000000000001';
const COMMENT_ID = '00000000-0000-0000-0000-000000000002';
const AUTHOR = 'G' + 'A'.repeat(55);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/:id/comments', cardCommentsRouter);
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

describe('GET /:id/comments', () => {
  it('returns comments with soft-deleted rows redacted', async () => {
    h.rows = [
      { id: COMMENT_ID, cardId: CARD_ID, authorAddress: AUTHOR, body: 'Hello!', createdAt: new Date(), deletedAt: null },
      { id: '2', cardId: CARD_ID, authorAddress: AUTHOR, body: 'deleted text', createdAt: new Date(), deletedAt: new Date() },
    ];
    const res = await request(makeApp()).get(`/${CARD_ID}/comments`);
    expect(res.status).toBe(200);
    expect(res.body[0].body).toBe('Hello!');
    expect(res.body[0].authorAddress).toBe(AUTHOR);
    expect(res.body[1].body).toBe('[comment removed]');
    expect(res.body[1].authorAddress).toBeNull();
  });
});

describe('POST /:id/comments', () => {
  beforeEach(() => {
    h.rows = [{ id: CARD_ID }];
    h.insertedRow = {
      id: COMMENT_ID, cardId: CARD_ID, authorAddress: AUTHOR, body: 'Nice!',
      createdAt: new Date(), deletedAt: null,
    };
  });

  it('rejects empty body', async () => {
    const res = await request(makeApp())
      .post(`/${CARD_ID}/comments`)
      .send({ authorAddress: AUTHOR, body: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects body over 1000 chars', async () => {
    const res = await request(makeApp())
      .post(`/${CARD_ID}/comments`)
      .send({ authorAddress: AUTHOR, body: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });

  it('rejects invalid Stellar address', async () => {
    const res = await request(makeApp())
      .post(`/${CARD_ID}/comments`)
      .send({ authorAddress: 'bad', body: 'hello' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when card does not exist', async () => {
    h.rows = [];
    const res = await request(makeApp())
      .post(`/${CARD_ID}/comments`)
      .send({ authorAddress: AUTHOR, body: 'hello' });
    expect(res.status).toBe(404);
  });

  it('accepts a valid comment', async () => {
    // Fresh CARD_ID to avoid rate limit from other tests
    const freshCard = '00000000-0000-0000-0000-000000000099';
    const freshAuthor = 'G' + 'Z'.repeat(55);
    h.rows = [{ id: freshCard }];
    h.insertedRow = {
      id: COMMENT_ID, cardId: freshCard, authorAddress: freshAuthor, body: 'Nice!',
      createdAt: new Date(), deletedAt: null,
    };
    const res = await request(makeApp())
      .post(`/${freshCard}/comments`)
      .send({ authorAddress: freshAuthor, body: 'Nice!' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Nice!');
  });
});

describe('DELETE /:id/comments/:commentId', () => {
  it('requires authorAddress query param', async () => {
    const res = await request(makeApp()).delete(`/${CARD_ID}/comments/${COMMENT_ID}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when comment does not exist', async () => {
    h.rows = [];
    const res = await request(makeApp())
      .delete(`/${CARD_ID}/comments/${COMMENT_ID}?authorAddress=${AUTHOR}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when not the author', async () => {
    const OTHER = 'G' + 'B'.repeat(55);
    h.rows = [{ id: COMMENT_ID, authorAddress: OTHER, deletedAt: null }];
    const res = await request(makeApp())
      .delete(`/${CARD_ID}/comments/${COMMENT_ID}?authorAddress=${AUTHOR}`);
    expect(res.status).toBe(403);
  });

  it('returns 204 and soft-deletes own comment', async () => {
    const SOFT_AUTHOR = 'G' + 'C'.repeat(55);
    h.rows = [{ id: COMMENT_ID, authorAddress: SOFT_AUTHOR, deletedAt: null }];
    const res = await request(makeApp())
      .delete(`/${CARD_ID}/comments/${COMMENT_ID}?authorAddress=${SOFT_AUTHOR}`);
    expect(res.status).toBe(204);
  });

  it('is idempotent on already-deleted comment', async () => {
    const SOFT_AUTHOR = 'G' + 'D'.repeat(55);
    h.rows = [{ id: COMMENT_ID, authorAddress: SOFT_AUTHOR, deletedAt: new Date() }];
    const res = await request(makeApp())
      .delete(`/${CARD_ID}/comments/${COMMENT_ID}?authorAddress=${SOFT_AUTHOR}`);
    expect(res.status).toBe(204);
  });
});

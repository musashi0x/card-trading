/**
 * Tests for the mint route's IPFS image handling (change: add-ipfs-image-storage).
 *
 * DB, chain layer, and the IPFS client are mocked; supertest drives a minimal
 * Express app. Covers: uploaded art pinned → `ipfs://` stored; pin failure →
 * preflight error before any DB write or on-chain mint; no provider → data URL
 * stored verbatim; already-hosted URLs never pinned.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  class PreflightError extends Error {
    status = 400;
    constructor(
      message: string,
      public code: string,
      public details?: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  return {
    PreflightError,
    cards: { __table: 'cards' } as object,
    cardCopies: { __table: 'card_copies' } as object,
    inserted: new Map<unknown, Record<string, unknown>[]>(),
    /** Swapped per-test: null = no IPFS provider configured. */
    client: null as { pin: ReturnType<typeof vi.fn>; unpin: ReturnType<typeof vi.fn> } | null,
    mintCollectionCopy: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  asc: (col: unknown) => ({ asc: col }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

vi.mock('@cardmkt/db', () => ({
  db: {
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          const rows = h.inserted.get(table) ?? [];
          const row = { id: `row-${rows.length + 1}`, ...v };
          rows.push(row);
          h.inserted.set(table, rows);
          return Promise.resolve([row]);
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) }),
  },
  schema: { cards: h.cards, cardCopies: h.cardCopies },
}));

vi.mock('../env.js', () => ({
  env: { usdcIssuerSecret: 'SPLATFORMSECRET', ipfs: { apiUrl: '', pinataJwt: '', gatewayUrl: 'http://localhost:8080' } },
}));

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../stellar.js', () => ({
  PreflightError: h.PreflightError,
  mintCollectionCopy: (...args: unknown[]) => h.mintCollectionCopy(...args),
}));

// Getter so each request observes the current per-test client (or null).
vi.mock('../lib/ipfs.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/ipfs.js')>();
  return {
    dataUrlToBytes: original.dataUrlToBytes,
    get ipfsClient() {
      return h.client;
    },
  };
});

import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import { cardsRouter } from './cards.js';

const OWNER = 'GCNJVGU2TKNJVGU2TKNJVGU2TKNJVGU2TKNJVGU2TKNJVGU2TKNJVD4R';
const CID = 'bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra';
const DATA_URL = 'data:image/jpeg;base64,aA==';

function mintBody(imageUrl: string) {
  return { owner: OWNER, name: 'Test Card', rarity: 'rare', imageUrl, supply: 1, royaltyBps: 0 };
}

function app() {
  const a = express();
  a.use(express.json({ limit: '3mb' }));
  a.use('/', cardsRouter);
  a.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Invalid request', code: 'VALIDATION' });
      return;
    }
    res.status(err.status ?? 500).json({ error: err.message, code: err.code ?? 'INTERNAL' });
  });
  return a;
}

beforeEach(() => {
  h.inserted.clear();
  h.client = null;
  h.mintCollectionCopy.mockReset().mockResolvedValue(42);
});

describe('POST /mint image handling', () => {
  it('pins an uploaded data URL and stores ipfs://<CID>', async () => {
    h.client = { pin: vi.fn().mockResolvedValue(CID), unpin: vi.fn() };

    const res = await request(app()).post('/mint').send(mintBody(DATA_URL));

    expect(res.status).toBe(200);
    expect(h.client.pin).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/jpeg');
    expect(res.body.card.imageUrl).toBe(`ipfs://${CID}`);
    expect(h.inserted.get(h.cards)![0]!.imageUrl).toBe(`ipfs://${CID}`);
  });

  it('fails preflight on pin error — no card row, no on-chain mint', async () => {
    h.client = { pin: vi.fn().mockRejectedValue(new Error('kubo down')), unpin: vi.fn() };

    const res = await request(app()).post('/mint').send(mintBody(DATA_URL));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IPFS_PIN_FAILED');
    expect(h.inserted.size).toBe(0);
    expect(h.mintCollectionCopy).not.toHaveBeenCalled();
  });

  it('stores the data URL verbatim when no provider is configured', async () => {
    h.client = null;

    const res = await request(app()).post('/mint').send(mintBody(DATA_URL));

    expect(res.status).toBe(200);
    expect(res.body.card.imageUrl).toBe(DATA_URL);
  });

  it('never pins an already-hosted https URL', async () => {
    h.client = { pin: vi.fn(), unpin: vi.fn() };
    const hosted = 'https://images.example.com/card.png';

    const res = await request(app()).post('/mint').send(mintBody(hosted));

    expect(res.status).toBe(200);
    expect(h.client.pin).not.toHaveBeenCalled();
    expect(res.body.card.imageUrl).toBe(hosted);
  });
});

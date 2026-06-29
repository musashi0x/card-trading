/**
 * Tests for the `buy_now` build pre-flight (change: fix-classic-buy-now-settlement).
 *
 * The on-chain `STATUS_OPEN` guard is the authoritative correctness gate (covered
 * by the Rust contract tests). Here we assert the API's fast-fail: a build for an
 * open listing returns an unsigned XDR, while a build for a sold/cancelled listing
 * is rejected with `LISTING_CLOSED` before any transaction is constructed — so the
 * buyer never signs a doomed transaction. The chain layer is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';
import { db, schema } from '@cardmkt/db';

vi.mock('../../env.js', () => ({
  env: {
    contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    platformIssuer: 'GCNJVGU2TKNJVGU2TKNJVGU2TKNJVGU2TKNJVGU2TKNJVGU2TKNJVD4R',
    feeBps: 200,
    logLevel: 'silent',
    usdc: { code: 'USDC', issuer: 'GAKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRL26G' },
    stellar: { networkPassphrase: 'Test SDF Network ; September 2015' },
  },
}));

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

// The chain layer: balances/trustlines pass, the contract op builds to a stub XDR.
vi.mock('../../stellar.js', () => ({
  PreflightError,
  buildContractTx: vi.fn(async () => 'UNSIGNED_XDR'),
  buildChangeTrustTx: vi.fn(async () => 'UNSIGNED_XDR'),
  buildPathPaymentTx: vi.fn(async () => 'UNSIGNED_XDR'),
  buildTrustlineTx: vi.fn(async () => 'UNSIGNED_XDR'),
  findStrictReceivePath: vi.fn(),
  getAssetBalance: vi.fn(async () => '0'),
  hasTrustline: vi.fn(async () => true),
  requireBalance: vi.fn(async () => {}),
  requireSourceBalance: vi.fn(async () => {}),
  requireTrustline: vi.fn(async () => {}),
  // On-chain listing read defaults to "open" so the happy path proceeds; cases
  // that exercise drift override this per-test.
  simulateContractView: vi.fn(async () => ({ kind: 'ok', value: { status: 0 } })),
  withSlippage: (x: string) => x,
}));

// NOTE: ./shared.js is intentionally NOT mocked — its guards (requireOnChainOpenListing
// etc.) are under test. They only build in-memory contract ops and delegate the
// network read to the mocked `simulateContractView` above, so the real module is safe.

const { buildRouter } = await import('./build.js');
const { hasTrustline, simulateContractView } = await import('../../stellar.js');

const { cards, listings, orders } = schema;
const BUYER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0xb1));
const SELLER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x5e));
const ISSUER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x15));

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/tx', buildRouter);
  app.use(
    (
      err: Error & { status?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ZodError) {
        res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid', code: 'VALIDATION' });
        return;
      }
      res.status(err.status ?? 500).json({
        error: err.message,
        code: err.code ?? 'INTERNAL',
        details: (err as { details?: Record<string, unknown> }).details,
      });
    },
  );
  return app;
}

let seq = 0;
async function makeListing(status: 'open' | 'sold' | 'cancelled'): Promise<string> {
  seq += 1;
  const [card] = await db
    .insert(cards)
    .values({
      assetCode: `CARD${seq}`,
      issuer: ISSUER,
      sacAddress: StrKey.encodeContract(Buffer.alloc(32, seq)),
      name: `Card ${seq}`,
      set: 'Base',
      rarity: 'rare',
      imageUrl: 'http://img/x.png',
    })
    .returning({ id: cards.id });
  const [listing] = await db
    .insert(listings)
    .values({
      cardId: card!.id,
      seller: SELLER,
      priceUsdc: '100',
      status,
      fulfillment: 'digital',
      contractListingId: 1,
    })
    .returning({ id: listings.id });
  return listing!.id;
}

const app = makeApp();

beforeEach(async () => {
  seq = 0;
  await db.execute(sql`TRUNCATE cards, listings, orders, trades RESTART IDENTITY CASCADE`);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/tx/buy-now pre-flight', () => {
  it('builds an unsigned buy_now for an open listing', async () => {
    const listingId = await makeListing('open');
    const res = await request(app).post('/api/tx/buy-now').send({ listingId, buyer: BUYER });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
    expect(res.body.refId).toBe(listingId);
  });

  it('rejects a sold listing with LISTING_CLOSED before building', async () => {
    const listingId = await makeListing('sold');
    const res = await request(app).post('/api/tx/buy-now').send({ listingId, buyer: BUYER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LISTING_CLOSED');
  });

  it('rejects a cancelled listing with LISTING_CLOSED', async () => {
    const listingId = await makeListing('cancelled');
    const res = await request(app).post('/api/tx/buy-now').send({ listingId, buyer: BUYER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LISTING_CLOSED');
  });

  it('rejects with LISTING_UNAVAILABLE when the contract has no such listing (drifted mirror)', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'missing' });
    const listingId = await makeListing('open');
    const res = await request(app).post('/api/tx/buy-now').send({ listingId, buyer: BUYER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LISTING_UNAVAILABLE');
    // The phantom row is retired so it stops being offered.
    const [row] = await db.select().from(listings).where(eq(listings.id, listingId));
    expect(row!.status).toBe('cancelled');
  });

  it('rejects with LISTING_CLOSED when the on-chain listing is already sold', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'ok', value: { status: 1 } });
    const listingId = await makeListing('open');
    const res = await request(app).post('/api/tx/buy-now').send({ listingId, buyer: BUYER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LISTING_CLOSED');
    const [row] = await db.select().from(listings).where(eq(listings.id, listingId));
    expect(row!.status).toBe('sold');
  });

  it('proceeds when the on-chain read is unverifiable (transient RPC), deferring to the contract', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'unknown' });
    const listingId = await makeListing('open');
    const res = await request(app).post('/api/tx/buy-now').send({ listingId, buyer: BUYER });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
  });

  it('returns a change_trust recovery XDR when the buyer lacks a USDC trustline', async () => {
    vi.mocked(hasTrustline).mockResolvedValueOnce(false);
    const listingId = await makeListing('open');
    const res = await request(app).post('/api/tx/buy-now').send({ listingId, buyer: BUYER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_TRUSTLINE');
    // The client signs + submits this to self-heal, then retries the build.
    expect(res.body.details.xdr).toBe('UNSIGNED_XDR');
    expect(res.body.details.assetCode).toBe('USDC');
  });
});

describe('sweepAbandonedOrders', () => {
  it('deletes abandoned funded orders but keeps confirmed and in-flight ones', async () => {
    const { sweepAbandonedOrders } = await import('../../data/orders.js');
    const listingId = await makeListing('open');
    const old = new Date(Date.now() - 60 * 60 * 1000); // 1h ago

    // Abandoned: funded, no contract id, no tx hash, old → swept.
    await db.insert(orders).values({
      listingId, buyer: BUYER, seller: SELLER, amountUsdc: '100',
      status: 'funded', createdAt: old,
    });
    // Confirmed-but-unparsed: has a tx hash → preserved.
    await db.insert(orders).values({
      listingId, buyer: BUYER, seller: SELLER, amountUsdc: '100',
      status: 'funded', escrowTxHash: 'HASH', createdAt: old,
    });
    // Recent abandoned: within TTL → preserved (signature may still be in flight).
    await db.insert(orders).values({
      listingId, buyer: BUYER, seller: SELLER, amountUsdc: '100',
      status: 'funded',
    });

    await sweepAbandonedOrders();

    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.escrowTxHash === 'HASH')).toBe(true);
  });
});

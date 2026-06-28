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
import { sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';
import { db, schema } from '@cardmkt/db';

vi.mock('../../env.js', () => ({
  env: {
    contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    platformIssuer: 'GPLATFORMISSUER',
    feeBps: 200,
    logLevel: 'silent',
    usdc: { code: 'USDC', issuer: 'GUSDCISSUER' },
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
  withSlippage: (x: string) => x,
}));

// The contract client + helpers; the op itself is opaque to buildContractTx.
vi.mock('./shared.js', () => ({
  contract: { buyNow: vi.fn(() => ({ op: 'buy_now' })) },
  usdc: { code: 'USDC' },
  notFound: (what: string) => {
    throw new PreflightError(`${what} not found`, 'NOT_FOUND');
  },
  needContractId: (value: number | null, what: string) => {
    if (value == null) throw new PreflightError(`${what} not confirmed`, 'NOT_CONFIRMED');
    return value;
  },
  requireCreatorTrustline: vi.fn(async () => {}),
}));

const { buildRouter } = await import('./build.js');

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
      res.status(err.status ?? 500).json({ error: err.message, code: err.code ?? 'INTERNAL' });
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

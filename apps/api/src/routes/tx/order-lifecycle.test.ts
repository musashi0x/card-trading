/**
 * Tests for the order-lifecycle build pre-flight (change: on-chain-source-of-truth).
 *
 * `mark_shipped`/`confirm_receipt`/`dispute`/`claim_timeout` act on an escrow
 * order. The mirror can say `funded`/`shipped` while the order already released or
 * refunded on-chain, which would trap the action after the user signs. The shared
 * `requireOnChainActiveOrder` guard rejects a terminal/gone order up front. The
 * chain layer is mocked; `./shared.js` runs for real so the guard is under test.
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
  // Order reads default to an active (funded = code 0) order; drift cases override.
  simulateContractView: vi.fn(async () => ({ kind: 'ok', value: { status: 0 } })),
  withSlippage: (x: string) => x,
}));

// NOTE: ./shared.js is intentionally NOT mocked — requireOnChainActiveOrder is under test.

const { buildRouter } = await import('./build.js');
const { simulateContractView } = await import('../../stellar.js');

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
async function makeOrder(): Promise<string> {
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
      status: 'sold',
      fulfillment: 'physical',
      contractListingId: 1,
    })
    .returning({ id: listings.id });
  const [order] = await db
    .insert(orders)
    .values({
      listingId: listing!.id,
      buyer: BUYER,
      seller: SELLER,
      amountUsdc: '100',
      status: 'funded',
      contractOrderId: 1,
    })
    .returning({ id: orders.id });
  return order!.id;
}

const app = makeApp();

beforeEach(async () => {
  seq = 0;
  await db.execute(sql`TRUNCATE cards, listings, orders, trades RESTART IDENTITY CASCADE`);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/tx/mark-shipped pre-flight', () => {
  it('builds an unsigned mark_shipped for an active funded order', async () => {
    const orderId = await makeOrder();
    const res = await request(app).post('/api/tx/mark-shipped').send({ orderId, account: SELLER });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
    expect(res.body.refId).toBe(orderId);
  });

  it('rejects with ORDER_CLOSED when the order already released on-chain', async () => {
    // ORDER_* code 3 = released (terminal).
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'ok', value: { status: 3 } });
    const orderId = await makeOrder();
    const res = await request(app).post('/api/tx/mark-shipped').send({ orderId, account: SELLER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORDER_CLOSED');
  });

  it('rejects with ORDER_CLOSED when the order is gone on-chain', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'missing' });
    const orderId = await makeOrder();
    const res = await request(app).post('/api/tx/mark-shipped').send({ orderId, account: SELLER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORDER_CLOSED');
  });

  it('proceeds when the on-chain read is unverifiable (transient RPC)', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'unknown' });
    const orderId = await makeOrder();
    const res = await request(app).post('/api/tx/mark-shipped').send({ orderId, account: SELLER });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
  });
});

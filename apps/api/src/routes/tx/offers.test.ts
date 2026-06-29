/**
 * Tests for the offer build pre-flights (change: on-chain-source-of-truth).
 *
 * `make_offer` locks the buyer's USDC against a listing; `accept_offer` settles
 * an offer. Both can be handed a drifted Postgres mirror (a listing or offer that
 * has closed on-chain) and would otherwise trap the contract after the user signs.
 * Here we assert the API's fast-fail: the build is rejected with a clean code and
 * the mirror is synced before any doomed transaction is constructed. The chain
 * layer is mocked; `./shared.js` runs for real so its guards are under test.
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
  // On-chain reads default to "open"; drift cases override per-test.
  simulateContractView: vi.fn(async () => ({ kind: 'ok', value: { status: 0 } })),
  withSlippage: (x: string) => x,
}));

// NOTE: ./shared.js is intentionally NOT mocked — its offer/listing guards are under test.

const { buildRouter } = await import('./build.js');
const { simulateContractView } = await import('../../stellar.js');

const { cards, listings, offers } = schema;
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
async function makeListing(): Promise<string> {
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
      status: 'open',
      fulfillment: 'digital',
      contractListingId: 1,
    })
    .returning({ id: listings.id });
  return listing!.id;
}

async function makeOffer(listingId: string): Promise<string> {
  const [offer] = await db
    .insert(offers)
    .values({
      listingId,
      buyer: BUYER,
      amountUsdc: '50',
      status: 'open',
      contractOfferId: 1,
    })
    .returning({ id: offers.id });
  return offer!.id;
}

const app = makeApp();

beforeEach(async () => {
  seq = 0;
  await db.execute(sql`TRUNCATE cards, listings, offers, trades RESTART IDENTITY CASCADE`);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/tx/make-offer pre-flight', () => {
  it('builds an unsigned make_offer against an open listing', async () => {
    const listingId = await makeListing();
    const res = await request(app)
      .post('/api/tx/make-offer')
      .send({ listingId, buyer: BUYER, amountUsdc: '50' });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
    expect(res.body.refId).toBeTruthy();
  });

  it('rejects with LISTING_UNAVAILABLE when the listing is gone on-chain (drift)', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'missing' });
    const listingId = await makeListing();
    const res = await request(app)
      .post('/api/tx/make-offer')
      .send({ listingId, buyer: BUYER, amountUsdc: '50' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LISTING_UNAVAILABLE');
    const [row] = await db.select().from(listings).where(eq(listings.id, listingId));
    expect(row!.status).toBe('cancelled');
  });
});

describe('POST /api/tx/accept-offer pre-flight', () => {
  it('builds an unsigned accept_offer for an open offer', async () => {
    const listingId = await makeListing();
    const offerId = await makeOffer(listingId);
    const res = await request(app).post('/api/tx/accept-offer').send({ offerId, seller: SELLER });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
    expect(res.body.refId).toBe(offerId);
  });

  it('rejects with OFFER_CLOSED and marks the offer withdrawn when gone on-chain', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'missing' });
    const listingId = await makeListing();
    const offerId = await makeOffer(listingId);
    const res = await request(app).post('/api/tx/accept-offer').send({ offerId, seller: SELLER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OFFER_CLOSED');
    const [row] = await db.select().from(offers).where(eq(offers.id, offerId));
    expect(row!.status).toBe('withdrawn');
  });

  it('rejects with OFFER_CLOSED and marks the offer settled when already settled on-chain', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'ok', value: { status: 1 } });
    const listingId = await makeListing();
    const offerId = await makeOffer(listingId);
    const res = await request(app).post('/api/tx/accept-offer').send({ offerId, seller: SELLER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OFFER_CLOSED');
    const [row] = await db.select().from(offers).where(eq(offers.id, offerId));
    expect(row!.status).toBe('settled');
  });
});

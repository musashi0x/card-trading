/**
 * Tests for the auction build pre-flights (change: validate-auction-workflow).
 *
 * The on-chain guards in the settlement contract are the authoritative correctness
 * gates (covered by the Rust contract tests). Here we assert the API's fast-fail so
 * a user never signs a transaction the contract is certain to trap: a bid on an
 * ended auction, a self-bid, a premature settle, and a cancel of an auction that
 * already has bids are all rejected before any XDR is built. The chain layer is
 * mocked; the happy paths return the stub unsigned XDR.
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
    collectionContractId: 'CDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBKN4',
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
  // On-chain reads default to "open" so happy paths proceed; the place-bid auction
  // guard relies on this. Drift behavior for auctions is covered elsewhere.
  simulateContractView: vi.fn(async () => ({ kind: 'ok', value: { status: 0 } })),
  withSlippage: (x: string) => x,
}));

// NOTE: ./shared.js is intentionally NOT mocked — its guards build in-memory contract
// ops and delegate the network read to the mocked `simulateContractView` above.

const { buildRouter } = await import('./build.js');
const { simulateContractView } = await import('../../stellar.js');

const { cards, cardCopies, auctions, bids } = schema;
// Globally unique token ids: `card_copies.token_id` is unique across the DB and
// vitest runs test files in parallel against the same database.
function nextTokenId(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

const SELLER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x5e));
const BIDDER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0xb1));
const ISSUER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x15));

const HOUR = 60 * 60 * 1000;

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
async function makeAuction(opts: {
  status?: 'open' | 'settled' | 'cancelled' | 'no_winner';
  endsAt?: Date;
  seller?: string;
  startPriceUsdc?: string;
  highBidder?: string | null;
  highBidUsdc?: string;
}): Promise<string> {
  seq += 1;
  const [card] = await db
    .insert(cards)
    .values({
      name: `Card ${seq}`,
      set: 'Base',
      rarity: 'rare',
      imageUrl: 'http://img/x.png',
    })
    .returning({ id: cards.id });
  const [copy] = await db
    .insert(cardCopies)
    .values({ cardId: card!.id, tokenId: nextTokenId(), serial: 1, owner: (opts.seller ?? SELLER) })
    .returning({ id: cardCopies.id });
  const [auction] = await db
    .insert(auctions)
    .values({
      cardId: card!.id,
      cardCopyId: copy!.id,
      seller: opts.seller ?? SELLER,
      startPriceUsdc: opts.startPriceUsdc ?? '100',
      reservePriceUsdc: '0',
      endsAt: opts.endsAt ?? new Date(Date.now() + HOUR),
      highBidder: opts.highBidder ?? null,
      highBidUsdc: opts.highBidUsdc ?? '0',
      status: opts.status ?? 'open',
      contractAuctionId: 1,
    })
    .returning({ id: auctions.id });
  return auction!.id;
}

const app = makeApp();

beforeEach(async () => {
  seq = 0;
  await db.execute(sql`TRUNCATE cards, auctions, bids RESTART IDENTITY CASCADE`);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/tx/place-bid pre-flight', () => {
  it('builds an unsigned place_bid for a valid bid on a live auction', async () => {
    const auctionId = await makeAuction({});
    const res = await request(app)
      .post('/api/tx/place-bid')
      .send({ auctionId, bidder: BIDDER, amountUsdc: '150' });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
    expect(res.body.refId).toBeTruthy();
  });

  it('rejects a bid on an ended auction with AUCTION_EXPIRED', async () => {
    const auctionId = await makeAuction({ endsAt: new Date(Date.now() - HOUR) });
    const res = await request(app)
      .post('/api/tx/place-bid')
      .send({ auctionId, bidder: BIDDER, amountUsdc: '150' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUCTION_EXPIRED');
  });

  it('rejects a seller bidding on their own auction with SELF_TRADE', async () => {
    const auctionId = await makeAuction({});
    const res = await request(app)
      .post('/api/tx/place-bid')
      .send({ auctionId, bidder: SELLER, amountUsdc: '150' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SELF_TRADE');
  });

  it('rejects a bid on a settled auction with AUCTION_CLOSED', async () => {
    const auctionId = await makeAuction({ status: 'settled' });
    const res = await request(app)
      .post('/api/tx/place-bid')
      .send({ auctionId, bidder: BIDDER, amountUsdc: '150' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUCTION_CLOSED');
  });

  it('rejects a bid below the start price with BID_TOO_LOW', async () => {
    const auctionId = await makeAuction({ startPriceUsdc: '100' });
    const res = await request(app)
      .post('/api/tx/place-bid')
      .send({ auctionId, bidder: BIDDER, amountUsdc: '50' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BID_TOO_LOW');
  });

  it('rejects a bid when the auction is gone on-chain despite an open mirror (drift)', async () => {
    // DB row reads open + live, but the chain has no such auction.
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'missing' });
    const auctionId = await makeAuction({});
    const res = await request(app)
      .post('/api/tx/place-bid')
      .send({ auctionId, bidder: BIDDER, amountUsdc: '150' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUCTION_CLOSED');
  });
});

describe('POST /api/tx/settle-auction pre-flight', () => {
  it('builds an unsigned settle_auction once the auction has ended', async () => {
    const auctionId = await makeAuction({ endsAt: new Date(Date.now() - HOUR) });
    const res = await request(app)
      .post('/api/tx/settle-auction')
      .send({ auctionId, account: BIDDER });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
    expect(res.body.refId).toBe(auctionId);
  });

  it('rejects settling a still-live auction with AUCTION_LIVE', async () => {
    const auctionId = await makeAuction({ endsAt: new Date(Date.now() + HOUR) });
    const res = await request(app)
      .post('/api/tx/settle-auction')
      .send({ auctionId, account: BIDDER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUCTION_LIVE');
  });

  it('rejects settling an already-settled auction with AUCTION_CLOSED', async () => {
    const auctionId = await makeAuction({ status: 'settled', endsAt: new Date(Date.now() - HOUR) });
    const res = await request(app)
      .post('/api/tx/settle-auction')
      .send({ auctionId, account: BIDDER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUCTION_CLOSED');
  });
});

describe('POST /api/tx/cancel-auction pre-flight', () => {
  it('builds an unsigned cancel_auction for a no-bid auction owned by the seller', async () => {
    const auctionId = await makeAuction({});
    const res = await request(app)
      .post('/api/tx/cancel-auction')
      .send({ auctionId, seller: SELLER });
    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe('UNSIGNED_XDR');
    expect(res.body.refId).toBe(auctionId);
  });

  it('rejects cancelling an auction that already has bids with AUCTION_HAS_BIDS', async () => {
    const auctionId = await makeAuction({ highBidder: BIDDER, highBidUsdc: '150' });
    const res = await request(app)
      .post('/api/tx/cancel-auction')
      .send({ auctionId, seller: SELLER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUCTION_HAS_BIDS');
  });

  it('rejects a cancel from someone other than the seller with NOT_SELLER', async () => {
    const auctionId = await makeAuction({});
    const res = await request(app)
      .post('/api/tx/cancel-auction')
      .send({ auctionId, seller: BIDDER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_SELLER');
  });

  it('rejects cancelling an already-closed auction with AUCTION_CLOSED', async () => {
    const auctionId = await makeAuction({ status: 'cancelled' });
    const res = await request(app)
      .post('/api/tx/cancel-auction')
      .send({ auctionId, seller: SELLER });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUCTION_CLOSED');
  });
});

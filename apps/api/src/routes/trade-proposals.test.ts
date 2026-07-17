/**
 * End-to-end tests for the barter trade-proposal flow (task group 9).
 *
 * These exercise the full request → Postgres lifecycle against the throwaway
 * `cardmkt_test` database, with the chain layer (XDR build, submit/relay, and
 * Horizon holdings) mocked — the on-chain asset movements themselves are covered
 * by the Rust contract tests (`packages/contracts/src/test.rs`). Here we assert
 * the observable DB transitions the e2e scenarios describe: a `proposed` row on
 * propose, an `accepted` row plus a settled `trades` row with `swap_tx_hash` on
 * accept, a `cancelled` row on cancel, and a zero fee on a pure card swap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';
import { db, schema } from '@cardmkt/db';

// --- mock the chain layer (no RPC / Horizon in tests) ----------------------

vi.mock('../env.js', () => ({
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

let hashSeq = 0;
vi.mock('../settlement/settle.js', () => ({
  // `propose_swap` returns the new on-chain proposal id (7) as its return value.
  signed: vi.fn(async () => ({ hash: `HASH_${++hashSeq}`, returnValue: 7, successful: true })),
  relayed: vi.fn(async () => ({ hash: `HASH_${++hashSeq}`, returnValue: 7, successful: true })),
  txSource: () => 'GSOURCE',
}));

vi.mock('../stellar.js', () => ({
  buildContractTx: vi.fn(async () => 'UNSIGNED_XDR'),
  // The proposer holds every give-side card by default.
  filterHeldCards: vi.fn(async (_owner: string, cards: unknown[]) => cards),
  isContractAddress: (a: string) => a.startsWith('C'),
  // Swap actions guard on the on-chain proposal still being `proposed` (code 10).
  // Ownership probes (`owner_of`) read as unverifiable, which the preflight
  // tolerates by design — the contract stays the final guard.
  simulateContractView: vi.fn(async (op: unknown) => {
    try {
      const fn = (op as any)
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .invokeContract()
        .functionName()
        .toString();
      if (fn === 'owner_of') return { kind: 'unknown' };
    } catch {
      // Fall through to the swap-view default.
    }
    return { kind: 'ok', value: { status: 10 } };
  }),
  requireTrustline: vi.fn(async () => {}),
  rpcServer: { getAccount: vi.fn().mockRejectedValue(new Error('no rpc in tests')) },
  PreflightError: class PreflightError extends Error {
    status = 400;
    constructor(
      message: string,
      public code: string,
      public details?: Record<string, unknown>,
    ) {
      super(message);
    }
  },
}));

// Imported after the mocks so the route picks up the mocked modules.
const { tradeProposalsRouter } = await import('./trade-proposals.js');
const { simulateContractView } = await import('../stellar.js');

const { cards, cardCopies, listings, trades, tradeProposals } = schema;

// Valid ed25519 public keys (checksum-correct strkeys the Address builder accepts).
const ALICE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0xa1));
const BOB = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0xb2));

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/trade-proposals', tradeProposalsRouter);
  // Minimal error shape mirroring the production handler.
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

let cardSeq = 0;
// Globally unique token ids: `card_copies.token_id` is unique across the DB and
// vitest runs test files in parallel against the same database.
function nextTokenId(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

/** Mint a card with one copy owned by `owner`; returns the copy id proposals reference. */
async function makeCard(owner: string): Promise<string> {
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
  const [copy] = await db
    .insert(cardCopies)
    .values({ cardId: row!.id, tokenId: nextTokenId(), serial: 1, owner })
    .returning({ id: cardCopies.id });
  return copy!.id;
}

/** Insert a confirmed (`contractSwapId` set) proposal directly, for action tests. */
async function seedProposal(opts: {
  proposer: string;
  counterparty: string;
  giveCardCopyIds: string[];
  getCardCopyIds: string[];
  cashUsdc?: string;
}): Promise<typeof tradeProposals.$inferSelect> {
  const [row] = await db
    .insert(tradeProposals)
    .values({
      proposer: opts.proposer,
      counterparty: opts.counterparty,
      giveCardCopyIds: opts.giveCardCopyIds,
      getCardCopyIds: opts.getCardCopyIds,
      cashUsdc: opts.cashUsdc ?? '0',
      status: 'proposed',
      contractSwapId: 7,
      proposeTxHash: 'PROPOSE_HASH',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return row!;
}

const app = makeApp();

beforeEach(async () => {
  hashSeq = 0;
  await db.execute(
    sql`TRUNCATE cards, listings, trades, trade_proposals RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => vi.clearAllMocks());

describe('barter trade proposals (e2e)', () => {
  // 9.1 — Alice proposes [cardA] for [cardB] with a 50 USDC sweetener.
  it('records a proposed row and locks the give-side card on propose', async () => {
    const cardA = await makeCard(ALICE);
    const cardB = await makeCard(BOB);

    const res = await request(app)
      .post('/api/trade-proposals')
      .send({ proposer: ALICE, counterparty: BOB, giveCardCopyIds: [cardA], getCardCopyIds: [cardB], cashUsdc: '50' });

    expect(res.status).toBe(200);
    expect(res.body.proposalId).toBeTruthy();
    expect(res.body.xdr).toBe('UNSIGNED_XDR');

    const [row] = await db
      .select()
      .from(tradeProposals)
      .where(eq(tradeProposals.id, res.body.proposalId));
    expect(row!.status).toBe('proposed');
    expect(row!.proposer).toBe(ALICE);
    expect(row!.counterparty).toBe(BOB);
    expect(row!.giveCardCopyIds).toEqual([cardA]);
    expect(Number(row!.cashUsdc)).toBe(50);

    // Submitting the signed propose_swap captures the on-chain proposal id.
    const submit = await request(app)
      .post('/api/trade-proposals')
      .send({ proposalId: res.body.proposalId, signedXdr: 'SIGNED' });
    expect(submit.status).toBe(200);
    expect(submit.body.contractSwapId).toBe(7);

    const [confirmed] = await db
      .select()
      .from(tradeProposals)
      .where(eq(tradeProposals.id, res.body.proposalId));
    expect(confirmed!.contractSwapId).toBe(7);
    expect(confirmed!.proposeTxHash).toBeTruthy();
  });

  // 9.2 — Bob accepts; status→accepted, a trades row carries swap_tx_hash + fee.
  it('settles an accepted swap and writes a trades row with swap_tx_hash', async () => {
    const cardA = await makeCard(ALICE);
    const cardB = await makeCard(BOB);
    const p = await seedProposal({
      proposer: ALICE,
      counterparty: BOB,
      giveCardCopyIds: [cardA],
      getCardCopyIds: [cardB],
      cashUsdc: '100',
    });

    const res = await request(app)
      .post(`/api/trade-proposals/${p.id}/accept`)
      .send({ account: BOB, signedXdr: 'SIGNED' });
    expect(res.status).toBe(200);
    expect(res.body.hash).toBeTruthy();

    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, p.id));
    expect(row!.status).toBe('accepted');
    expect(row!.swapTxHash).toBeTruthy();
    expect(Number(row!.feeUsdc)).toBe(2); // 100 * 200bps / 10_000

    // The indexer reconciliation wrote the settled trade row keyed by swap hash.
    const tradeRows = await db.select().from(trades).where(eq(trades.swapTxHash, row!.swapTxHash!));
    expect(tradeRows).toHaveLength(1);
    expect(tradeRows[0]!.buyer).toBe(BOB);
    expect(tradeRows[0]!.seller).toBe(ALICE);
    expect(tradeRows[0]!.listingId).toBeNull();
    expect(Number(tradeRows[0]!.priceUsdc)).toBe(100);
    expect(Number(tradeRows[0]!.feeUsdc)).toBe(2);
  });

  // On-chain drift: the proposal already moved past `proposed` (e.g. executed via
  // another path), so accept must fast-fail before relaying a doomed swap.
  it('rejects accepting a proposal no longer proposed on-chain with SWAP_CLOSED', async () => {
    vi.mocked(simulateContractView).mockResolvedValueOnce({ kind: 'ok', value: { status: 11 } });
    const cardA = await makeCard(ALICE);
    const cardB = await makeCard(BOB);
    const p = await seedProposal({
      proposer: ALICE,
      counterparty: BOB,
      giveCardCopyIds: [cardA],
      getCardCopyIds: [cardB],
    });
    const res = await request(app)
      .post(`/api/trade-proposals/${p.id}/accept`)
      .send({ account: BOB, signedXdr: 'SIGNED' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SWAP_CLOSED');
    // The proposal row is untouched (still proposed) — no settlement happened.
    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, p.id));
    expect(row!.status).toBe('proposed');
  });

  // 9.3 — Alice proposes then cancels; status→cancelled.
  it('cancels a proposal back to the proposer', async () => {
    const cardA = await makeCard(ALICE);
    const p = await seedProposal({
      proposer: ALICE,
      counterparty: BOB,
      giveCardCopyIds: [cardA],
      getCardCopyIds: [],
    });

    const res = await request(app)
      .post(`/api/trade-proposals/${p.id}/cancel`)
      .send({ account: ALICE, signedXdr: 'SIGNED' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, p.id));
    expect(row!.status).toBe('cancelled');

    // Only the proposer can cancel.
    const p2 = await seedProposal({ proposer: ALICE, counterparty: BOB, giveCardCopyIds: [cardA], getCardCopyIds: [] });
    const denied = await request(app)
      .post(`/api/trade-proposals/${p2.id}/cancel`)
      .send({ account: BOB, signedXdr: 'SIGNED' });
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe('NOT_PROPOSER');
  });

  // 9.4 — Pure card-for-card swap (no USDC): fee is zero, no value moves.
  it('charges no fee on a pure card-for-card swap', async () => {
    const cardA = await makeCard(ALICE);
    const cardB = await makeCard(BOB);
    const p = await seedProposal({
      proposer: ALICE,
      counterparty: BOB,
      giveCardCopyIds: [cardA],
      getCardCopyIds: [cardB],
      cashUsdc: '0',
    });

    const res = await request(app)
      .post(`/api/trade-proposals/${p.id}/accept`)
      .send({ account: BOB, signedXdr: 'SIGNED' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, p.id));
    expect(row!.status).toBe('accepted');
    expect(Number(row!.feeUsdc)).toBe(0);

    const tradeRows = await db.select().from(trades).where(eq(trades.swapTxHash, row!.swapTxHash!));
    expect(tradeRows).toHaveLength(1);
    expect(Number(tradeRows[0]!.feeUsdc)).toBe(0);
    expect(Number(tradeRows[0]!.priceUsdc)).toBe(0);
  });

  // The self-trade guard rejects before any row or chain build.
  it('rejects a self-trade at validation', async () => {
    const cardA = await makeCard(ALICE);
    const res = await request(app)
      .post('/api/trade-proposals')
      .send({ proposer: ALICE, counterparty: ALICE, giveCardCopyIds: [cardA], getCardCopyIds: [] });
    expect(res.status).toBe(400);
  });
});

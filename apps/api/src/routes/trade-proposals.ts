/**
 * Barter trade proposals (task group 5).
 *
 * A proposal locks the proposer's give-side cards (and any USDC sweetener) into
 * contract custody via `propose_swap`; the counterparty `execute_swap`s to settle
 * atomically, or either side cancels/declines to return the locked assets. Each
 * action follows the established build → sign → submit pattern: call the endpoint
 * without `signedXdr` to get the unsigned XDR, then call it again with the signed
 * envelope to submit (classic) or relay (passkey smart wallet).
 *
 * The chain is the source of truth; the indexer (see indexer.ts) reconciles
 * `trade_proposals` status from `get_swap_view` and writes the settled `trades`
 * row. These handlers update the mirror optimistically for instant feedback.
 */

import { Router } from 'express';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import {
  MarketplaceContract,
  proposeSwapSchema,
  swapActionSchema,
  swapQuerySchema,
  toStroops,
  type Card,
  type TradeProposal,
} from '@cardmkt/shared';
import { env } from '../env.js';
import { buildContractTx, filterHeldCards, isContractAddress, PreflightError } from '../stellar.js';
import * as settle from '../settlement/settle.js';
import { feeFor } from '../data/trades.js';
import { reconcileSwaps } from '../indexer.js';
import { requireOnChainProposedSwap } from './tx/shared.js';

export const tradeProposalsRouter: Router = Router();

const contract = new MarketplaceContract(env.contractId);
const { cards, tradeProposals } = schema;

/** Proposals expire 7 days after creation (enforced by the API, not the contract). */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Pull a signed envelope out of the body, if the caller is submitting one. */
function signedXdrOf(body: unknown): string | undefined {
  const xdr = (body as { signedXdr?: unknown })?.signedXdr;
  return typeof xdr === 'string' && xdr.length > 0 ? xdr : undefined;
}

/** Submit (classic) or relay (passkey smart wallet) a signed envelope for `actor`. */
function settleFor(actor: string, signedXdr: string): Promise<settle.Settlement> {
  return isContractAddress(actor) ? settle.relayed(signedXdr) : settle.signed(signedXdr);
}

/** Building unsigned XDR needs a classic source; passkey wallets build client-side. */
function requireClassicSource(actor: string): void {
  if (isContractAddress(actor)) {
    throw new PreflightError(
      'Passkey smart-wallet swaps are signed client-side; submit the signed envelope instead',
      'PASSKEY_BUILD_UNSUPPORTED',
      { actor },
    );
  }
}

/** Load cards by id, preserving the requested order; throws if any is missing. */
async function loadCardsInOrder(ids: string[]): Promise<(typeof cards.$inferSelect)[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(cards).where(inArray(cards.id, ids));
  const byId = new Map(rows.map((c) => [c.id, c]));
  return ids.map((id) => {
    const card = byId.get(id);
    if (!card) throw new PreflightError(`Card ${id} not found`, 'CARD_NOT_FOUND', { cardId: id });
    return card;
  });
}

/** The on-chain card token (SAC) for a card, or an actionable error if undeployed. */
function tokenOf(card: { id: string; sacAddress: string | null }): string {
  if (!card.sacAddress) {
    throw new PreflightError('Card asset contract not deployed', 'CARD_SAC_MISSING', {
      cardId: card.id,
    });
  }
  return card.sacAddress;
}

function toCardDto(c: typeof cards.$inferSelect): Card {
  return {
    id: c.id,
    assetCode: c.assetCode,
    issuer: c.issuer,
    sacAddress: c.sacAddress,
    name: c.name,
    set: c.set,
    rarity: c.rarity,
    imageUrl: c.imageUrl,
    supply: c.supply,
    creatorAccount: c.creatorAccount,
    royaltyBps: c.royaltyBps,
  };
}

/** Shape a DB row into the API's `TradeProposal`, attaching joined card metadata. */
function toDto(row: typeof tradeProposals.$inferSelect, cardsById: Map<string, Card>): TradeProposal {
  const pick = (ids: string[]) => ids.map((id) => cardsById.get(id)).filter((c): c is Card => !!c);
  return {
    id: row.id,
    proposer: row.proposer,
    counterparty: row.counterparty,
    giveCardIds: row.giveCardIds,
    getCardIds: row.getCardIds,
    giveCards: pick(row.giveCardIds),
    getCards: pick(row.getCardIds),
    cashUsdc: row.cashUsdc,
    feeUsdc: row.feeUsdc,
    status: row.status,
    contractSwapId: row.contractSwapId,
    proposeTxHash: row.proposeTxHash,
    swapTxHash: row.swapTxHash,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadProposal(id: string): Promise<typeof tradeProposals.$inferSelect> {
  const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, id));
  if (!row) throw new PreflightError('Proposal not found', 'PROPOSAL_NOT_FOUND', { id });
  return row;
}

function requireProposed(row: { status: string }): void {
  if (row.status !== 'proposed') {
    throw new PreflightError(`Proposal is already ${row.status}`, 'BAD_STATE', { status: row.status });
  }
}

// GET /api/trade-proposals?party=G…|C…[&status=…] — incoming + outgoing proposals.
tradeProposalsRouter.get('/', async (req, res, next) => {
  try {
    const { party, status } = swapQuerySchema.parse(req.query);
    const partyFilter = or(eq(tradeProposals.proposer, party), eq(tradeProposals.counterparty, party));
    const where = status ? and(partyFilter, eq(tradeProposals.status, status)) : partyFilter;
    const rows = await db
      .select()
      .from(tradeProposals)
      .where(where)
      .orderBy(desc(tradeProposals.createdAt));

    // Join card metadata for every referenced card in one query.
    const cardIds = [...new Set(rows.flatMap((r) => [...r.giveCardIds, ...r.getCardIds]))];
    const cardRows = cardIds.length
      ? await db.select().from(cards).where(inArray(cards.id, cardIds))
      : [];
    const cardsById = new Map(cardRows.map((c) => [c.id, toCardDto(c)]));

    res.json(rows.map((r) => toDto(r, cardsById)));
  } catch (err) {
    next(err);
  }
});

// POST /api/trade-proposals — create (build propose_swap) or submit the signed tx.
tradeProposalsRouter.post('/', async (req, res, next) => {
  try {
    const signedXdr = signedXdrOf(req.body);

    // Second call: submit/relay the signed `propose_swap` and capture the on-chain
    // proposal id (the contract's return value) plus the tx hash.
    if (signedXdr) {
      const proposalId = String((req.body as { proposalId?: unknown }).proposalId ?? '');
      const row = await loadProposal(proposalId);
      requireProposed(row);
      const result = await settleFor(row.proposer, signedXdr);
      const contractSwapId =
        typeof result.returnValue === 'number'
          ? result.returnValue
          : Number(result.returnValue ?? NaN);
      await db
        .update(tradeProposals)
        .set({
          proposeTxHash: result.hash,
          contractSwapId: Number.isFinite(contractSwapId) ? contractSwapId : null,
        })
        .where(eq(tradeProposals.id, row.id));
      res.json({ hash: result.hash, successful: true, contractSwapId });
      return;
    }

    // First call: validate, verify holdings, build the XDR, and record the row.
    const input = proposeSwapSchema.parse(req.body);
    requireClassicSource(input.proposer);

    const giveCards = await loadCardsInOrder(input.giveCardIds);
    const getCards = await loadCardsInOrder(input.getCardIds);

    // The proposer must actually hold every give-side card on-chain.
    const held = await filterHeldCards(input.proposer, giveCards);
    if (held.length !== giveCards.length) {
      const heldIds = new Set(held.map((c) => c.id));
      const missing = giveCards.filter((c) => !heldIds.has(c.id)).map((c) => c.id);
      throw new PreflightError('Proposer does not hold all give-side cards', 'MISSING_CARD', {
        missing,
      });
    }

    const cashUsdc = input.cashUsdc ?? '0';
    const op = contract.proposeSwap(
      input.proposer,
      input.counterparty,
      giveCards.map(tokenOf),
      getCards.map(tokenOf),
      toStroops(cashUsdc),
    );
    const xdr = await buildContractTx(input.proposer, op);

    const [row] = await db
      .insert(tradeProposals)
      .values({
        proposer: input.proposer,
        counterparty: input.counterparty,
        giveCardIds: input.giveCardIds,
        getCardIds: input.getCardIds,
        cashUsdc,
        status: 'proposed',
        expiresAt: new Date(Date.now() + EXPIRY_MS),
      })
      .returning();

    res.json({ proposalId: row!.id, xdr, networkPassphrase: env.stellar.networkPassphrase });
  } catch (err) {
    next(err);
  }
});

// POST /api/trade-proposals/:id/accept — counterparty executes the swap.
tradeProposalsRouter.post('/:id/accept', async (req, res, next) => {
  try {
    const { account } = swapActionSchema.parse(req.body);
    const row = await loadProposal(req.params.id);
    if (row.counterparty !== account) {
      throw new PreflightError('Only the counterparty can accept this proposal', 'NOT_COUNTERPARTY');
    }
    requireProposed(row);
    if (row.contractSwapId == null) {
      throw new PreflightError('Proposal is not yet confirmed on-chain', 'NOT_CONFIRMED');
    }
    // Confirm the proposal is still `proposed` on-chain before building/relaying —
    // it may have been executed, declined, or cancelled via another path.
    await requireOnChainProposedSwap(row.contractSwapId);

    const signedXdr = signedXdrOf(req.body);
    if (!signedXdr) {
      requireClassicSource(account);
      const xdr = await buildContractTx(account, contract.executeSwap(account, row.contractSwapId));
      res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase });
      return;
    }

    const result = await settleFor(account, signedXdr);
    await db
      .update(tradeProposals)
      .set({ status: 'accepted', swapTxHash: result.hash, feeUsdc: feeFor(row.cashUsdc) })
      .where(eq(tradeProposals.id, row.id));
    // Reconcile immediately so the settled `trades` row appears without waiting
    // for the next indexer tick.
    await reconcileSwaps().catch(() => {});
    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/trade-proposals/:id/decline — counterparty declines; cards returned.
tradeProposalsRouter.post('/:id/decline', async (req, res, next) => {
  try {
    const { account } = swapActionSchema.parse(req.body);
    const row = await loadProposal(req.params.id);
    if (row.counterparty !== account) {
      throw new PreflightError('Only the counterparty can decline this proposal', 'NOT_COUNTERPARTY');
    }
    requireProposed(row);
    if (row.contractSwapId == null) {
      throw new PreflightError('Proposal is not yet confirmed on-chain', 'NOT_CONFIRMED');
    }
    // Confirm the proposal is still `proposed` on-chain before building/relaying —
    // it may have been executed, declined, or cancelled via another path.
    await requireOnChainProposedSwap(row.contractSwapId);

    const signedXdr = signedXdrOf(req.body);
    if (!signedXdr) {
      requireClassicSource(account);
      const xdr = await buildContractTx(account, contract.declineSwap(account, row.contractSwapId));
      res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase });
      return;
    }

    const result = await settleFor(account, signedXdr);
    await db
      .update(tradeProposals)
      .set({ status: 'declined' })
      .where(eq(tradeProposals.id, row.id));
    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/trade-proposals/:id/cancel — proposer cancels; cards returned.
tradeProposalsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const { account } = swapActionSchema.parse(req.body);
    const row = await loadProposal(req.params.id);
    if (row.proposer !== account) {
      throw new PreflightError('Only the proposer can cancel this proposal', 'NOT_PROPOSER');
    }
    // An expired proposal is still `proposed` on-chain, so the proposer can still
    // reclaim its locked assets via cancel_swap even after the API expired it.
    if (row.status !== 'proposed' && row.status !== 'expired') {
      throw new PreflightError(`Proposal is already ${row.status}`, 'BAD_STATE', {
        status: row.status,
      });
    }
    if (row.contractSwapId == null) {
      throw new PreflightError('Proposal is not yet confirmed on-chain', 'NOT_CONFIRMED');
    }
    // Confirm the proposal is still `proposed` on-chain before building/relaying —
    // it may have been executed, declined, or cancelled via another path.
    await requireOnChainProposedSwap(row.contractSwapId);

    const signedXdr = signedXdrOf(req.body);
    if (!signedXdr) {
      requireClassicSource(account);
      const xdr = await buildContractTx(account, contract.cancelSwap(account, row.contractSwapId));
      res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase });
      return;
    }

    const result = await settleFor(account, signedXdr);
    await db
      .update(tradeProposals)
      .set({ status: 'cancelled' })
      .where(eq(tradeProposals.id, row.id));
    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Catalog + search (task 5.1). Served from the Postgres read-mirror.
 */

import { Router } from 'express';
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import { MarketplaceContract, listingsQuerySchema } from '@cardmkt/shared';
import { env } from '../env.js';
import { filterHeldCards, simulateContractView } from '../stellar.js';

export const catalogRouter: Router = Router();

const { cards, listings } = schema;

const contract = new MarketplaceContract(env.contractId);

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

// GET /api/cards[?owner=G…|C…] — the full card registry, or, when `owner` is
// given, only the cards that wallet actually holds on-chain (the "cards I hold"
// picker). Without `owner` this stays the unfiltered catalog.
catalogRouter.get('/cards', async (req, res, next) => {
  try {
    const rows = await db.select().from(cards);
    const owner = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
    if (!owner) {
      res.json(rows);
      return;
    }
    if (!STELLAR_ADDRESS.test(owner)) {
      res.status(400).json({ error: 'Invalid owner address', code: 'INVALID_OWNER' });
      return;
    }
    res.json(await filterHeldCards(owner, rows));
  } catch (err) {
    next(err);
  }
});

catalogRouter.get('/listings', async (req, res, next) => {
  try {
    const q = listingsQuerySchema.parse(req.query);
    const filters: SQL[] = [eq(listings.status, q.status ?? 'open')];
    if (q.set) filters.push(eq(cards.set, q.set));
    if (q.rarity) filters.push(eq(cards.rarity, q.rarity));
    if (q.q) {
      const term = `%${q.q}%`;
      const match = or(ilike(cards.name, term), ilike(cards.set, term), ilike(cards.rarity, term));
      if (match) filters.push(match);
    }

    const rows = await db
      .select({
        id: listings.id,
        cardId: listings.cardId,
        seller: listings.seller,
        priceUsdc: listings.priceUsdc,
        status: listings.status,
        fulfillment: listings.fulfillment,
        contractListingId: listings.contractListingId,
        escrowTxHash: listings.escrowTxHash,
        createdAt: listings.createdAt,
        card: {
          id: cards.id,
          assetCode: cards.assetCode,
          issuer: cards.issuer,
          sacAddress: cards.sacAddress,
          name: cards.name,
          set: cards.set,
          rarity: cards.rarity,
          imageUrl: cards.imageUrl,
          supply: cards.supply,
          creatorAccount: cards.creatorAccount,
          royaltyBps: cards.royaltyBps,
        },
      })
      .from(listings)
      .innerJoin(cards, eq(listings.cardId, cards.id))
      .where(and(...filters))
      .orderBy(desc(listings.createdAt));

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * A single listing by id — used by the buyer's pre-conversion recheck so a
 * pay-with-any-asset flow can confirm the listing is still open before spending
 * on the irreversible currency conversion.
 */
catalogRouter.get('/listings/:id', async (req, res, next) => {
  try {
    const [row] = await db
      .select({
        id: listings.id,
        cardId: listings.cardId,
        seller: listings.seller,
        priceUsdc: listings.priceUsdc,
        status: listings.status,
        fulfillment: listings.fulfillment,
        contractListingId: listings.contractListingId,
        escrowTxHash: listings.escrowTxHash,
        createdAt: listings.createdAt,
      })
      .from(listings)
      .where(eq(listings.id, req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Listing not found', code: 'NOT_FOUND' });
      return;
    }
    // This endpoint gates an irreversible asset conversion, so it must reflect the
    // CHAIN, not just the (possibly lagging) mirror. If the row reads open, confirm
    // on-chain; on a definitive drift, sync the row and return the true status so
    // the buyer's recheck never green-lights a conversion for a closed listing. An
    // unverifiable RPC read leaves the mirror value as-is (tolerate the transient).
    if (row.status === 'open' && row.contractListingId != null) {
      const view = await simulateContractView(contract.getListingView(row.contractListingId));
      if (view.kind === 'missing') {
        await db.update(listings).set({ status: 'cancelled' }).where(eq(listings.id, row.id));
        row.status = 'cancelled';
      } else if (view.kind === 'ok') {
        // Contract STATUS_* codes: 0 = open, 1 = sold, 2 = cancelled.
        const code = Number(view.value.status ?? 0);
        if (code !== 0) {
          row.status = code === 1 ? 'sold' : 'cancelled';
          await db.update(listings).set({ status: row.status }).where(eq(listings.id, row.id));
        }
      }
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
});

/** Offers for a listing — used by the seller's accept view. */
catalogRouter.get('/listings/:id/offers', async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(schema.offers)
      .where(eq(schema.offers.listingId, req.params.id))
      .orderBy(desc(schema.offers.amountUsdc));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

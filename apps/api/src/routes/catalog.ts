/**
 * Catalog + search (task 5.1). Served from the Postgres read-mirror.
 */

import { Router } from 'express';
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import { listingsQuerySchema } from '@cardmkt/shared';

export const catalogRouter: Router = Router();

const { cards, listings } = schema;

catalogRouter.get('/cards', async (_req, res, next) => {
  try {
    const rows = await db.select().from(cards);
    res.json(rows);
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

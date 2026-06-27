/**
 * Per-wallet watchlist. Open-auth like `/api/orders` — the wallet address is a
 * query/body parameter, not a secret. Keyed by listing; closed listings are
 * pruned by the indexer, and the GET join also filters to `open` as a safety net.
 */

import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cardmkt/db';

export const watchlistRouter: Router = Router();

const { cards, listings, watchlist } = schema;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

const addSchema = z.object({
  account: z.string().regex(STELLAR_ADDRESS, 'Must be a valid Stellar address (G… or C…)'),
  listingId: z.string().uuid('listingId must be a UUID'),
});

// GET /api/watchlist?account=G…|C… — the wallet's watched open listings.
watchlistRouter.get('/', async (req, res, next) => {
  try {
    const account = typeof req.query.account === 'string' ? req.query.account.trim() : '';
    if (!STELLAR_ADDRESS.test(account)) {
      res.status(400).json({ error: 'Invalid account address', code: 'INVALID_ACCOUNT' });
      return;
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
        watchId: watchlist.id,
        watchedAt: watchlist.createdAt,
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
      .from(watchlist)
      .innerJoin(listings, eq(watchlist.listingId, listings.id))
      .innerJoin(cards, eq(listings.cardId, cards.id))
      .where(and(eq(watchlist.account, account), eq(listings.status, 'open')))
      .orderBy(desc(watchlist.createdAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/watchlist — add a listing to the wallet's watchlist (idempotent).
watchlistRouter.post('/', async (req, res, next) => {
  try {
    const { account, listingId } = addSchema.parse(req.body);
    const [listing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId));
    if (!listing) {
      res.status(404).json({ error: 'Listing not found', code: 'LISTING_NOT_FOUND' });
      return;
    }
    const inserted = await db
      .insert(watchlist)
      .values({ account, listingId })
      .onConflictDoNothing()
      .returning({ id: watchlist.id });
    res.status(inserted.length ? 201 : 200).json({ ok: true, watching: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/watchlist/:listingId?account=G…|C… — remove a watch (idempotent).
watchlistRouter.delete('/:listingId', async (req, res, next) => {
  try {
    const account = typeof req.query.account === 'string' ? req.query.account.trim() : '';
    if (!STELLAR_ADDRESS.test(account)) {
      res.status(400).json({ error: 'Invalid account address', code: 'INVALID_ACCOUNT' });
      return;
    }
    await db
      .delete(watchlist)
      .where(and(eq(watchlist.account, account), eq(watchlist.listingId, req.params.listingId)));
    res.json({ ok: true, watching: false });
  } catch (err) {
    next(err);
  }
});

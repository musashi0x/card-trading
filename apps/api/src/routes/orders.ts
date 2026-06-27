/**
 * Physical-escrow order reads, served from the Postgres mirror.
 *
 * `GET /api/orders?account=G…|C…` returns orders where the account is buyer or
 * seller (the "my orders" view). `GET /api/orders/disputed` lists open disputes
 * for the arbiter dashboard. Each row joins the card so the UI can render it.
 */

import { Router } from 'express';
import { desc, eq, or } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';

export const ordersRouter: Router = Router();

const { orders, listings, cards } = schema;

const ACCOUNT = /^[GC][A-Z2-7]{55}$/;

const orderSelect = {
  id: orders.id,
  listingId: orders.listingId,
  buyer: orders.buyer,
  seller: orders.seller,
  amountUsdc: orders.amountUsdc,
  status: orders.status,
  contractOrderId: orders.contractOrderId,
  confirmDeadline: orders.confirmDeadline,
  trackingRef: orders.trackingRef,
  escrowTxHash: orders.escrowTxHash,
  settleTxHash: orders.settleTxHash,
  createdAt: orders.createdAt,
  card: {
    id: cards.id,
    name: cards.name,
    set: cards.set,
    rarity: cards.rarity,
    imageUrl: cards.imageUrl,
  },
} as const;

// Open disputes for the arbiter. Defined before the parameterless `/` so it is
// matched as a literal path.
ordersRouter.get('/disputed', async (_req, res, next) => {
  try {
    const rows = await db
      .select(orderSelect)
      .from(orders)
      .innerJoin(listings, eq(orders.listingId, listings.id))
      .innerJoin(cards, eq(listings.cardId, cards.id))
      .where(eq(orders.status, 'disputed'))
      .orderBy(desc(orders.createdAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

ordersRouter.get('/', async (req, res, next) => {
  try {
    const account = typeof req.query.account === 'string' ? req.query.account.trim() : '';
    if (!ACCOUNT.test(account)) {
      res.status(400).json({ error: 'Invalid or missing account', code: 'INVALID_ACCOUNT' });
      return;
    }
    const rows = await db
      .select(orderSelect)
      .from(orders)
      .innerJoin(listings, eq(orders.listingId, listings.id))
      .innerJoin(cards, eq(listings.cardId, cards.id))
      .where(or(eq(orders.buyer, account), eq(orders.seller, account)))
      .orderBy(desc(orders.createdAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

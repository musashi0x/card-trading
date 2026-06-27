/**
 * Trade history (task 5.6). Each row carries the on-chain settlement tx hash so
 * the web client can link to a block explorer.
 */

import { Router } from 'express';
import { desc, eq, or } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';

export const tradesRouter: Router = Router();

tradesRouter.get('/', async (req, res, next) => {
  try {
    // Optional `?account=` narrows to trades where the wallet is buyer or seller
    // (mirrors the `/api/orders?account=` pattern); absent, the full feed returns.
    const account = typeof req.query.account === 'string' ? req.query.account : undefined;
    const where = account
      ? or(eq(schema.trades.buyer, account), eq(schema.trades.seller, account))
      : undefined;
    const rows = await db
      .select()
      .from(schema.trades)
      .where(where)
      .orderBy(desc(schema.trades.settledAt));
    // Surface the full split: price = seller net + platform fee + creator royalty.
    const withNet = rows.map((t) => ({
      ...t,
      sellerNetUsdc: (Number(t.priceUsdc) - Number(t.feeUsdc) - Number(t.royaltyUsdc)).toFixed(7),
    }));
    res.json(withNet);
  } catch (err) {
    next(err);
  }
});

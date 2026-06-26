/**
 * Trade history (task 5.6). Each row carries the on-chain settlement tx hash so
 * the web client can link to a block explorer.
 */

import { Router } from 'express';
import { desc } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';

export const tradesRouter: Router = Router();

tradesRouter.get('/', async (_req, res, next) => {
  try {
    const rows = await db.select().from(schema.trades).orderBy(desc(schema.trades.settledAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

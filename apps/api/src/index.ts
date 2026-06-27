/**
 * API entrypoint. Wires middleware and mounts route modules.
 * Route handlers are implemented in task group 5.
 */

import cors from 'cors';
import express from 'express';
import { ZodError } from 'zod';
import { env } from './env.js';
import { catalogRouter } from './routes/catalog.js';
import { cardsRouter } from './routes/cards.js';
import { txRouter } from './routes/tx.js';
import { ordersRouter } from './routes/orders.js';
import { tradesRouter } from './routes/trades.js';
import { devRouter } from './routes/dev.js';
import { startIndexer } from './indexer.js';

const app = express();

app.use(cors({ origin: env.webOrigin }));
// Generous limit so a card's uploaded photo can ride along as a data URL.
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api', catalogRouter);
app.use('/api/tx', txRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/trades', tradesRouter);
// Dev-only conveniences (e.g. funding a smart wallet with test USDC).
if (env.stellar.network !== 'mainnet') app.use('/api/dev', devRouter);
// Card minting issues assets with the platform issuer key — never on mainnet.
if (env.stellar.network !== 'mainnet') app.use('/api/cards', cardsRouter);

// Centralized error shape so the web client can rely on { error, code }.
app.use(
  (err: Error & { code?: string; status?: number; details?: Record<string, unknown> }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Request-body validation failures are client errors, not 500s. Surface the
    // first issue as a readable message the web client can show directly.
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.join('.');
      res.status(400).json({
        error: first ? (where ? `${where}: ${first.message}` : first.message) : 'Invalid request',
        code: 'VALIDATION',
        details: { issues: err.issues },
      });
      return;
    }
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message, code: err.code ?? 'INTERNAL', details: err.details });
  },
);

app.listen(env.port, () => {
  console.log(`[api] listening on :${env.port} (${env.stellar.network})`);
  startIndexer();
});

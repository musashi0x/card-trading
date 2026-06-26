/**
 * API entrypoint. Wires middleware and mounts route modules.
 * Route handlers are implemented in task group 5.
 */

import cors from 'cors';
import express from 'express';
import { env } from './env.js';
import { catalogRouter } from './routes/catalog.js';
import { txRouter } from './routes/tx.js';
import { tradesRouter } from './routes/trades.js';
import { devRouter } from './routes/dev.js';
import { startIndexer } from './indexer.js';

const app = express();

app.use(cors({ origin: env.webOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api', catalogRouter);
app.use('/api/tx', txRouter);
app.use('/api/trades', tradesRouter);
// Dev-only conveniences (e.g. funding a smart wallet with test USDC).
if (env.stellar.network !== 'mainnet') app.use('/api/dev', devRouter);

// Centralized error shape so the web client can rely on { error, code }.
app.use(
  (err: Error & { code?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message, code: err.code ?? 'INTERNAL' });
  },
);

app.listen(env.port, () => {
  console.log(`[api] listening on :${env.port} (${env.stellar.network})`);
  startIndexer();
});

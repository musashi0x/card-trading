/**
 * API entrypoint. Wires middleware and mounts route modules.
 * Route handlers are implemented in task group 5.
 */

import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import { env } from './env.js';
import { logger } from './logger.js';
import { runWithContext } from './context.js';
import { catalogRouter } from './routes/catalog.js';
import { cardsRouter } from './routes/cards.js';
import { txRouter } from './routes/tx.js';
import { ordersRouter } from './routes/orders.js';
import { auctionsRouter } from './routes/auctions.js';
import { tradesRouter } from './routes/trades.js';
import { tradeProposalsRouter } from './routes/trade-proposals.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { watchlistRouter } from './routes/watchlist.js';
import { profilesRouter } from './routes/profiles.js';
import { portfolioRouter } from './routes/portfolio.js';
import { devRouter } from './routes/dev.js';
import { cardReviewsRouter } from './routes/card-reviews.js';
import { cardCommentsRouter } from './routes/card-comments.js';
import { startIndexer } from './indexer.js';

const app = express();

// Trust only the first proxy hop so per-IP rate limiting keys off the real
// client address without letting clients spoof `X-Forwarded-For` to bypass it.
// (A blanket `true` is trivially bypassable; override via deployment if there
// are multiple proxy hops.)
app.set('trust proxy', 1);

app.use(cors({ origin: env.webOrigins }));
// Generous limit so a card's uploaded photo can ride along as a data URL.
app.use(express.json({ limit: '10mb' }));

/**
 * Accept an inbound correlation id only if it's a sane token — bounded length
 * and a safe charset — so a caller can't inject control characters or smuggle
 * data through the id we echo back and log.
 */
const SAFE_REQUEST_ID = /^[\w.\-:]{1,200}$/;

// Structured request/response logging. Assigns a correlation id per request
// (honoring a valid inbound `x-request-id`), echoes it as `X-Request-Id`, and
// exposes a request-scoped child logger as `req.log`.
app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const inbound = req.headers['x-request-id'];
      const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
      const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    // Severity reflects the outcome: client errors warn, server errors error.
    customLogLevel(_req, res, err) {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }),
);

// Bind the request's logger + id into async context so code far from the
// request (stellar build, relay submit) can log with the same correlation id.
app.use((req, _res, next) => {
  runWithContext({ log: req.log, reqId: String(req.id) }, () => next());
});

// Per-IP rate limiting shields shared upstreams (Stellar RPC, relay, Postgres)
// from a single client overwhelming the service.
app.use(
  rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      req.log.warn({ ip: req.ip, path: req.path }, 'rate limit exceeded');
      res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' });
    },
  }),
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api', catalogRouter);
app.use('/api/tx', txRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/auctions', auctionsRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/trade-proposals', tradeProposalsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/catalog/:id/reviews', cardReviewsRouter);
app.use('/api/catalog/:id/comments', cardCommentsRouter);
// Dev-only conveniences (e.g. funding a smart wallet with test USDC).
if (env.stellar.network !== 'mainnet') app.use('/api/dev', devRouter);
// Card minting issues assets with the platform issuer key — never on mainnet.
if (env.stellar.network !== 'mainnet') app.use('/api/cards', cardsRouter);

// Centralized error shape so the web client can rely on { error, code }.
app.use(
  (
    err: Error & { code?: string; status?: number; details?: Record<string, unknown> },
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    // Request-body validation failures are client errors, not 500s. Surface the
    // first issue as a readable message the web client can show directly.
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.join('.');
      req.log.warn({ err, issues: err.issues }, 'request validation failed');
      res.status(400).json({
        error: first ? (where ? `${where}: ${first.message}` : first.message) : 'Invalid request',
        code: 'VALIDATION',
        details: { issues: err.issues },
      });
      return;
    }
    const status = err.status ?? 500;
    // Log before responding so handled errors are never silently swallowed.
    // Fall back to the module logger if the request-scoped logger is unavailable
    // (e.g. an error thrown before pino-http attached `req.log`), so the error
    // handler itself never throws and mask the original failure.
    const level = status >= 500 ? 'error' : 'warn';
    (req.log ?? logger)[level]({ err, code: err.code ?? 'INTERNAL', status }, 'request failed');
    res.status(status).json({ error: err.message, code: err.code ?? 'INTERNAL', details: err.details });
  },
);

const server = app.listen(env.port, () => {
  logger.info({ port: env.port, network: env.stellar.network }, 'api listening');
});

const stopIndexer = startIndexer();

// Graceful shutdown: stop accepting new connections, drain in-flight requests
// within a bounded grace period, and stop the background indexer before exit.
const GRACE_MS = 10_000;
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  stopIndexer();
  server.close(() => {
    logger.info('drained in-flight requests, exiting');
    process.exit(0);
  });
  // Hard cap: don't hang forever if a connection refuses to close.
  setTimeout(() => {
    logger.warn('grace period elapsed, forcing exit');
    process.exit(1);
  }, GRACE_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

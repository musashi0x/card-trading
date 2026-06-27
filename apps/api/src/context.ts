/**
 * Request-scoped logging context, backed by Node's native `AsyncLocalStorage`.
 *
 * The HTTP middleware enters a store carrying the request's correlation id and
 * child logger. Code invoked deep in a request — Stellar transaction building,
 * relay submission — that never receives `req` can call `getLog()` and log with
 * the originating request's id, with no parameter threading. Each request runs
 * in its own async store, so concurrent users never share a correlation id.
 *
 * Outside any request (e.g. the background indexer, or boot), there is no store
 * and `getLog()` falls back to the base logger.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { logger } from './logger.js';

interface RequestContext {
  log: Logger;
  reqId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` (and everything it awaits) within a request-scoped logging context. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The request-scoped logger when inside a request, otherwise the base logger. */
export function getLog(): Logger {
  return storage.getStore()?.log ?? logger;
}

/** The current request's correlation id, if any. */
export function getReqId(): string | undefined {
  return storage.getStore()?.reqId;
}

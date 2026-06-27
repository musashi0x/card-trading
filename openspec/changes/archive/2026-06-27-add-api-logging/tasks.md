## 1. Dependencies & configuration

- [x] 1.1 Add `pino`, `pino-http`, and `express-rate-limit` to `apps/api` dependencies, and `pino-pretty` to devDependencies
- [x] 1.2 Add `LOG_LEVEL` (default `info`) and rate-limit settings (window + max) to `apps/api/src/env.ts`

## 2. Logger and request context

- [x] 2.1 Create `apps/api/src/logger.ts` exporting a configured pino instance: JSON in production, `pino-pretty` transport only when `NODE_ENV !== 'production'`, level from `env.logLevel`
- [x] 2.2 Add `redact` paths to the logger for `req.headers.authorization`, `req.headers.cookie`, secret keys, and signed XDR (`*.secret`, `signedXdr`, `*.xdr`, passkey/relay credentials)
- [x] 2.3 Create `apps/api/src/context.ts` wrapping `AsyncLocalStorage<{ log; reqId }>` with `getLog()` that falls back to the base logger when no request store is active

## 3. HTTP middleware wiring (`index.ts`)

- [x] 3.1 Configure `pino-http` with the shared logger and a `genReqId` that reuses a validated inbound `x-request-id` or generates `randomUUID()`, and echoes `X-Request-Id` on the response
- [x] 3.2 In the pino-http path, enter the `AsyncLocalStorage` store with the request's child logger + id so deep code can call `getLog()`
- [x] 3.3 Set `customLogLevel` so 2xx/3xx log at info, 4xx at warn, and 5xx/errors at error
- [x] 3.4 Mount the pino-http middleware before the routers (after CORS/json)
- [x] 3.5 Add `express-rate-limit` per-IP middleware in front of the routers, returning 429 and logging the throttle event

## 4. Error handling and console replacement

- [x] 4.1 Update the central error handler in `index.ts` to log before responding — Zod/4xx at warn, 5xx at error, including message, stack, and correlation id — leaving the `{ error, code, details }` body and status unchanged
- [x] 4.2 Replace the boot banner `console.log` in `index.ts` with the logger
- [x] 4.3 Replace `console.log`/`console.error` in `indexer.ts` with a base child logger (`{ component: 'indexer' }`)
- [x] 4.4 Replace the two `console.warn` calls in `stellar.ts` with `getLog()` from the async context

## 5. Graceful shutdown

- [x] 5.1 Capture the `http.Server` from `app.listen` and add `SIGTERM`/`SIGINT` handlers that stop accepting new connections and drain in-flight requests within a bounded grace period
- [x] 5.2 Stop the indexer interval on shutdown (expose a stop handle from `startIndexer`) so no reconciliation runs after exit begins

## 6. Verification

- [x] 6.1 Run `pnpm --filter @cardmkt/api typecheck` and ensure the build passes
- [x] 6.2 Start the API locally and confirm: each response carries `X-Request-Id`, an inbound `x-request-id` is honored, and request/completion lines share the correlation id
- [x] 6.3 Trigger a handled error and a Zod validation failure; confirm both are logged (error / warn) with the correlation id while the response body is unchanged
- [x] 6.4 Confirm a request with an `authorization` header logs it redacted and that no secret key or signed XDR appears in any log line
- [x] 6.5 Send `SIGTERM` during an in-flight request and confirm it drains and the indexer stops

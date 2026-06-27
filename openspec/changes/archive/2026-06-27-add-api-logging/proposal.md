## Why

The API (`apps/api`) currently has no real logging — only a handful of ad-hoc `console.log`/`console.warn`/`console.error` calls (boot banner in `index.ts`, `[indexer]` ticks, two warnings in `stellar.ts`). When more than one user hits the service concurrently, these unstructured lines interleave with no way to tell which request produced which line, no request/response record, no correlation id, and errors swallowed by the central handler vanish without a trace. This makes production triage of multi-user issues (a failed relay submit, a slow tx build, a 500) effectively impossible.

This change introduces structured, per-request logging and codifies the concurrency practices the service should follow so behaviour stays correct and observable under simultaneous users.

## What Changes

- Add a single shared structured logger (pino) for the API: JSON in production, pretty-printed in development, level controlled by `LOG_LEVEL`.
- Add HTTP request/response logging middleware (pino-http) that assigns a correlation id to every request (honoring an inbound `x-request-id`, echoing it back on the response) and exposes a request-scoped child logger as `req.log`.
- Propagate the correlation id and request-scoped logger through handlers via `AsyncLocalStorage`, so code far from the request (stellar build, relay submit) can log with the same id without threading a parameter everywhere.
- Redact secrets and sensitive fields (authorization/cookie headers, signed XDR, secret keys, passkey material) from all log output.
- Update the central Express error handler to log every error (with correlation id and stack) before returning the existing `{ error, code, details }` shape — fixing today's silent failures.
- Replace the ad-hoc `console.*` calls (`index.ts`, `indexer.ts`, `stellar.ts`) with the shared logger.
- Document and enforce multi-user/concurrency best practices: stateless request handlers (no module-level mutable per-user state), request-scoped context only, graceful shutdown that drains in-flight requests, and basic per-IP rate limiting to protect shared upstreams (Stellar RPC, relay, Postgres).
- Add `LOG_LEVEL` (and rate-limit) configuration to `env.ts`.

## Capabilities

### New Capabilities
- `api-observability`: structured logging, per-request correlation ids, secret redaction, error logging, and the multi-user concurrency practices (statelessness, graceful shutdown, rate limiting) the API follows to stay correct and debuggable under concurrent load.

### Modified Capabilities
<!-- No existing spec requirement changes its observable contract; logging is additive. -->

## Impact

- **Code**: `apps/api/src/index.ts` (middleware wiring, error handler, graceful shutdown), new `apps/api/src/logger.ts` and `apps/api/src/context.ts` (AsyncLocalStorage), `apps/api/src/env.ts` (new `LOG_LEVEL`/rate-limit config), `indexer.ts` and `stellar.ts` (swap `console.*`), route files (use `req.log` where they currently swallow context).
- **Dependencies**: add `pino`, `pino-http`; `pino-pretty` (dev) for local readability; `express-rate-limit` for per-IP limiting. No removals.
- **Operations**: stdout log format changes from sparse text to structured JSON; responses now carry an `X-Request-Id` header. No public API contract or response-body changes.
- **Performance**: pino is low-overhead; logging is async and should not measurably affect request latency.

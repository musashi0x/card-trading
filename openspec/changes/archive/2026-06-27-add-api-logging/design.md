## Context

`apps/api` is an Express 4 service (ESM, `type: module`, `.js`-suffixed imports) that builds/submits Stellar transactions, runs a background indexer, and serves catalog/order/trade reads from a Postgres mirror. Today it has effectively no logging: a boot banner in `index.ts`, `[indexer]` lines in `indexer.ts`, and two `console.warn` calls in `stellar.ts`. There is already a central Express error handler that returns `{ error, code, details }` — but it logs nothing, so handled errors disappear.

Under concurrent users, interleaved unstructured lines can't be attributed to a request, and a failed relay submit or slow tx build leaves no trace. The user asked for (1) a logger and (2) best practices for handling multiple users — which for an API means request correlation, statelessness, backpressure on shared upstreams, and clean shutdown.

Constraints:
- Must stay ESM, Express 4, no framework swap.
- Must not change the public response contract (`{ error, code, details }`, status codes).
- Must not leak secrets (signed XDR, secret keys, passkey/relay credentials) into logs.
- Low overhead — this sits in the hot path of every request.

## Goals / Non-Goals

**Goals:**
- One shared structured logger; replace all ad-hoc `console.*`.
- A correlation id per request, honored from `x-request-id` and echoed as `X-Request-Id`.
- A request-scoped logger reachable from deep code (stellar/relay) without parameter threading.
- Redaction of sensitive fields by default.
- Error handler logs before responding.
- Codify multi-user practices: stateless handlers, per-IP rate limit, graceful shutdown.

**Non-Goals:**
- Centralized log aggregation / shipping (Datadog, Loki, etc.) — out of scope; JSON-to-stdout is the integration point and platform collectors handle the rest.
- Distributed tracing / OpenTelemetry spans — correlation id only; tracing can layer on later.
- Authentication or per-user authorization changes (the API is key-custody-free by design).
- Metrics/Prometheus endpoints.
- Replacing the indexer's polling model.

## Decisions

### Decision: Use pino + pino-http (over winston / bunyan / roll-your-own)
- **Why**: pino is the lowest-overhead structured JSON logger for Node and is the de-facto standard for Express services; `pino-http` gives request/response logging, `genReqId`, `customLogLevel`, and built-in `req.log` child loggers with almost no glue. winston is heavier and slower in the hot path; a hand-rolled `console.log(JSON.stringify())` re-implements redaction, serializers, and levels badly.
- **Shape**: a single `logger.ts` exporting a configured pino instance; `pino-http` reuses it via `{ logger }`.
- **Dev ergonomics**: `pino-pretty` as a transport only when not production, so local output stays readable while prod stays pure JSON.

### Decision: Correlation id via `genReqId`, honoring inbound `x-request-id`
- **Why**: lets upstream proxies/clients supply an id for end-to-end correlation; otherwise generate `randomUUID()`. Echo back as `X-Request-Id` so clients can quote it in bug reports.
- **Alternative considered**: always generate our own — rejected because it breaks correlation when a gateway already assigns ids.

### Decision: Propagate request context with `AsyncLocalStorage`
- **Why**: stellar build and relay submit are several calls deep and don't receive `req`. Threading a logger through every signature is invasive and easy to forget. A small `context.ts` wrapping `AsyncLocalStorage<{ log; reqId }>` set in the pino-http path lets any code call `getLog()` and get the request's child logger (falling back to the base logger outside a request). This is also the cleanest way to guarantee no cross-request bleed under concurrency — each request runs in its own async store.
- **Alternative considered**: pass `req.log` explicitly — more correct-by-construction but high churn across `stellar.ts`/`relay.ts`; rejected for ergonomics. `cls-hooked` — superseded by native `AsyncLocalStorage`.

### Decision: Redaction via pino `redact` paths
- **Why**: declarative, fast, central. Paths cover `req.headers.authorization`, `req.headers.cookie`, and known secret-bearing keys (`*.secret`, `signedXdr`, `*.xdr`, passkey/relay credentials). Keeps secrets out without each call site remembering to scrub.
- **Trade-off**: redaction is path-based, so a secret logged under an unexpected key can still leak — mitigated by also never logging raw request bodies (which may carry signed XDR / image data URLs) and reviewing what handlers log.

### Decision: Error handler logs, then responds (contract unchanged)
- **Why**: fixes today's silent failures with the smallest change. 4xx (incl. Zod `VALIDATION`) logged at warn, 5xx at error, both with the correlation id and stack. Response body/status untouched.

### Decision: Multi-user practices — stateless handlers, per-IP rate limit, graceful shutdown
- **Statelessness**: keep request/user state in request scope or the async store only; no module-level mutable per-user maps. This is the core correctness property for concurrent users.
- **Rate limiting**: `express-rate-limit` (in-memory, per-IP) in front of the routers to shield the shared upstreams (Stellar RPC, relay, Postgres pool) from a single noisy client; returns 429. In-memory is fine for a single instance; a shared store (Redis) is the documented upgrade path for multi-instance.
- **Graceful shutdown**: on `SIGTERM`/`SIGINT`, stop `server.listen` from accepting new connections, drain in-flight within a grace window, and stop the indexer interval so reconciliation doesn't run during exit. This avoids cutting off in-flight tx builds mid-flight on deploy.

## Risks / Trade-offs

- **AsyncLocalStorage overhead / context loss** → pino-http establishes the store at the top of the request; native ALS overhead is negligible. Risk is losing context across a raw `setTimeout`/manual Promise pool; mitigate by reading `getLog()` synchronously where possible and falling back to the base logger when the store is empty (the indexer, which runs outside any request, simply uses the base logger).
- **Redaction gaps leak secrets** → never log full request bodies; keep an explicit redact path list; add a quick test asserting a secret-bearing object is masked.
- **In-memory rate limiter is per-instance** → acceptable for the current single-instance deployment; documented as needing a shared store before horizontal scaling. Set limits generously to avoid throttling legitimate bursty checkout flows.
- **Log volume / cost in production** → default `info`; request-received line can be disabled and only the completion line kept if volume is a concern.
- **Pretty transport in prod by mistake** → guard `pino-pretty` strictly on non-production `NODE_ENV` so prod always emits raw JSON.

## Migration Plan

1. Add deps: `pino`, `pino-http`, `express-rate-limit`; `pino-pretty` as dev dep.
2. Add `LOG_LEVEL` (+ rate-limit) to `env.ts`.
3. Land `logger.ts` and `context.ts`; wire `pino-http`, rate limiter, and graceful shutdown in `index.ts`; make the error handler log.
4. Swap `console.*` in `index.ts`, `indexer.ts`, `stellar.ts` for the shared/base logger.
5. Roll out behind no flag (purely additive to output). **Rollback**: revert the middleware wiring; routes keep working since `req.log` usage degrades to the base logger.

## Open Questions

- Rate-limit thresholds — what request/minute is safe for the checkout flow's legitimate bursts? (Start permissive, tune from real traffic.)
- Should the indexer get its own static child logger (`{ component: 'indexer' }`) for filtering? (Recommended; cheap.)
- Do we want the inbound `x-request-id` trusted unconditionally, or length/charset-validated before echoing to avoid header injection? (Recommend validating.)

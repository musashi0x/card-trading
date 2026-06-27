## Why

`apps/api/src/routes/tx.ts` is an 880-line module that mixes five concerns per endpoint — request validation, Horizon/RPC pre-flight, contract-op building, transaction submit/relay, and Postgres reconciliation — and carries the same logic twice because every trade flow exists in both a classic-wallet (`G…`) form and a passkey smart-wallet (`C…`) form.

Reconciliation is **wallet-agnostic**: given `(action, settlement hash, refId, actor)` the DB mutation is identical no matter who signed. But because it is physically interleaved with wallet-specific submit code, it is copy-pasted between the classic `/submit` switch and the `/passkey-*` endpoints. Three concrete duplications result:

- **Trade insertion** (`feeFor` + `royaltyFor` + `insert(trades)`) is written four times — `accept_offer` ([tx.ts:614](apps/api/src/routes/tx.ts:614)), classic `buy_now` ([tx.ts:635](apps/api/src/routes/tx.ts:635)), passkey `buy_now` ([tx.ts:727](apps/api/src/routes/tx.ts:727)), and `recordOrderTrade` ([tx.ts:254](apps/api/src/routes/tx.ts:254)) — differing only in the buyer-of-record.
- **Per-action reconciliation** is implemented once in the classic `switch(action)` ([tx.ts:584](apps/api/src/routes/tx.ts:584)) and again inline in the passkey handlers ([tx.ts:725](apps/api/src/routes/tx.ts:725), [:765](apps/api/src/routes/tx.ts:765), [:864](apps/api/src/routes/tx.ts:864)). The two copies can silently drift.
- **The "settle then reconcile" envelope** (submit/relay → throw `TX_FAILED` on failure → mutate DB) is repeated five times.

This makes the file hard to navigate, hard to review, and risky to extend: adding a new trade action or wallet kind means editing several places that must stay in agreement.

## What Changes

- **Extract a single reconciliation registry** keyed by `TradeAction` (`settlement/reconcile.ts`). Each action's DB mutation is written exactly once and called by *both* the classic and passkey submit paths, parameterized by the buyer-of-record `actor`. This is the keystone that removes the duplication.
- **Extract a settlement envelope** (`settlement/settle.ts`) that wraps "submit signed XDR" and "relay signed XDR" behind one shape (`{ hash, returnValue, successful }`) and raises the shared `TX_FAILED` error once.
- **Extract a data/repository layer** (`data/`) for the reconciliation queries and the fee/royalty/trade math (`recordTrade`, `listingWithCard`, `orderWithListingCard`, status transitions), so reconcilers and routes stop embedding drizzle and domain math inline.
- **Split `tx.ts` into focused route files** under `routes/tx/` — `build.ts` (classic unsigned-XDR builds), `submit.ts` (`/submit`, `/submit-classic`, `/resolve`), `passkey.ts` (`/passkey-*`) — each a thin handler that delegates to the registry, settlement, and data layers.
- Preserve **all** existing behavior, endpoints, request/response shapes, error codes, and pre-flight checks. No route paths change; the public API contract is identical.
- **BREAKING** (internal only): the single `tx.ts` module is removed and re-exported as the composed `txRouter`. No external/runtime contract changes.

## Capabilities

### New Capabilities
<!-- None. This is a behavior-preserving internal refactor. -->

### Modified Capabilities
- `marketplace-api`: adds one requirement making explicit the invariant this refactor establishes — settlement reconciliation runs through a single wallet-agnostic path, so classic (`G…`) and passkey (`C…`) settlements of the same action produce identical DB effects, the registry is exhaustive over trade actions at compile time, and release reconciliation stays idempotent. All other `marketplace-api`, `passkey-smart-wallet`, and `pay-with-any-asset` requirements are preserved exactly; only the internal module structure changes.

## Impact

- **Affected code** (all within `apps/api/src/`):
  - `routes/tx.ts` — removed; decomposed into `routes/tx/{build,submit,passkey}.ts` plus an `index.ts` that composes and exports `txRouter`.
  - New `settlement/reconcile.ts` (per-action registry) and `settlement/settle.ts` (submit/relay envelope).
  - New `data/` layer (`listings.ts`, `offers.ts`, `orders.ts`, `trades.ts`) holding the reconciliation queries, status transitions, and `recordTrade` fee/royalty math currently inline in `tx.ts`.
  - `index.ts` — import path for `txRouter` only (still `./routes/tx/index.js` or `./routes/tx.js` re-export); no middleware changes.
- **Not changed**: `stellar.ts`, `relay.ts`, `indexer.ts`, `env.ts`, `logger.ts`, `context.ts`, and the read-only routes (`catalog.ts`, `orders.ts`, `trades.ts`, `cards.ts`, `dev.ts`).
- **Dependencies**: none added.
- **Systems**: API only. No smart-contract, data-model, or frontend changes.
- **Risk**: medium-low — pure restructuring with no contract change, guarded by typecheck and the existing endpoint behavior. The chief risk is a reconciliation regression, mitigated by porting one action at a time and diffing against the original switch.

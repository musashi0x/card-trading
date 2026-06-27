## Context

`routes/tx.ts` (880 lines) owns every write path of the marketplace: the classic-wallet build endpoints (`/list`, `/make-offer`, `/accept-offer`, `/buy-now`, `/cancel`, `/withdraw-offer`, the escrow order actions, `/trustline`, `/quote-path`, `/path-payment`), the classic submit endpoint (`/submit` with its `switch(action)` reconciliation, plus `/submit-classic` and `/resolve`), and the passkey relay endpoints (`/passkey-deploy`, `/passkey-submit`, `/passkey-list`, `/passkey-order`).

It leans on two service modules that are already well-factored and stay as-is: `stellar.ts` (build/submit primitives, pre-flight reads, issuer-op queue) and `relay.ts` (the `RelaySubmitter` Strategy). The problem is not those services — it is that `tx.ts` interleaves wallet-specific submission with wallet-agnostic DB reconciliation, so the reconciliation is duplicated between the classic and passkey paths.

The duplication is concentrated, not diffuse: it lives almost entirely in the **reconcile** step. The **build** endpoints are genuinely distinct (each has a different pre-flight), so they are not a duplication source and do not warrant a shared abstraction.

## Goals / Non-Goals

**Goals:**
- A single source of truth for per-action DB reconciliation, shared by the classic and passkey submit paths.
- One place for trade-row creation and its fee/royalty math.
- `tx.ts` broken into focused files, none a god-module.
- Identical external behavior: same routes, payloads, status codes, error codes, pre-flight checks, and reconciliation outcomes.

**Non-Goals:**
- No changes to `stellar.ts`, `relay.ts`, or `indexer.ts` (a separate `stellar.ts` split was considered and deferred — see the explore notes; not in scope here).
- No change to the wallet-duality at the *build* layer (no `WalletAdapter` abstraction in this change — that is a larger, separate proposal).
- No new dependency, framework, or DI container.
- No API contract, data-model, or smart-contract changes.

## Decisions

### Decision 1: A reconciliation registry keyed by `TradeAction` (the keystone)

Introduce `settlement/reconcile.ts` exporting one function plus an internal action→fn table:

```ts
export interface ReconcileCtx {
  refId: string;        // listing/offer/order row id created at build time
  hash: string;         // settlement tx hash
  returnValue: unknown; // parsed contract return (e.g. new contract id)
  actor: string;        // buyer/seller of record (G… signer source OR C… address)
}

const reconcilers: Record<TradeAction, (c: ReconcileCtx) => Promise<void>> = {
  list:            async (c) => { /* set contractListingId + escrowTxHash */ },
  make_offer:      async (c) => { /* set contractOfferId + escrowTxHash */ },
  cancel_listing:  async (c) => { /* status: cancelled */ },
  withdraw_offer:  async (c) => { /* status: withdrawn */ },
  accept_offer:    async (c) => { /* offer settled, listing sold, recordTrade */ },
  buy_now:         async (c) => { /* listing sold, recordTrade(buyer = actor) */ },
  purchase_escrow: async (c) => { /* set contractOrderId, listing sold */ },
  mark_shipped:    async (c) => { /* status: shipped */ },
  confirm_receipt: async (c) => { /* status: released, recordOrderTrade */ },
  claim_timeout:   async (c) => { /* status: released, recordOrderTrade */ },
  dispute:         async (c) => { /* status: disputed */ },
};

export const reconcile = (a: TradeAction, c: ReconcileCtx) => reconcilers[a](c);
```

Both submit paths become the same three lines, differing only in how `actor` is derived and whether the settlement was submitted or relayed:

```ts
// classic /submit
const r = await settle.signed(signedXdr);
await reconcile(action, { refId, hash: r.hash, returnValue: r.returnValue, actor: txSource(signedXdr) });

// passkey /passkey-submit (and /passkey-list, /passkey-order)
const r = await settle.relayed(input.signedXdr);
await reconcile(action, { refId, hash: r.hash, returnValue: r.returnValue, actor: input.buyer /* C… */ });
```

**Why a `Record<TradeAction, fn>` and not a class-based Command pattern:** the actions share no build-time behavior worth a base class, and the duplication is purely in reconcile. A plain typed map gives the same exhaustiveness guarantee from TypeScript (every `TradeAction` key must be present) with far less ceremony. The `actor` parameter absorbs the only real difference between the two wallet paths (buyer-of-record), so no per-wallet branching is needed inside a reconciler.

**The idempotency guard is preserved:** `confirm_receipt`/`claim_timeout` keep the `if (order.status !== 'released')` check ([tx.ts:669](apps/api/src/routes/tx.ts:669)) inside their reconciler, so a re-submit or indexer race stays a no-op.

**Alternative considered:** keep two switches but extract only `recordTrade`. Rejected — it removes DUP #1 but leaves the two reconcile copies free to drift (DUP #2), which is the more dangerous one.

### Decision 2: A settlement envelope unifies submit vs relay

`settlement/settle.ts` exposes two functions returning the same shape and raising the same error, so the route never repeats the `if (!successful) throw TX_FAILED` block:

```ts
export interface Settlement { hash: string; returnValue: unknown; successful: true; }
export function signed(signedXdr: string): Promise<Settlement>;   // wraps submitSignedTx
export function relayed(signedXdr: string): Promise<Settlement>;  // wraps relaySubmitter().submit + transactionReturnValue
```

`signed` uses `submitSignedTx` (which already returns `returnValue`). `relayed` uses the relay (which returns only a hash) and recovers `returnValue` via `transactionReturnValue(hash)` — exactly what the passkey handlers do today ([tx.ts:739](apps/api/src/routes/tx.ts:739), [tx.ts:784](apps/api/src/routes/tx.ts:784)) — so the registry can read `returnValue` uniformly regardless of path.

### Decision 3: A thin data/repository layer

Move reconciliation-time persistence out of the routes into `data/`:

| File | Holds |
| --- | --- |
| `data/trades.ts` | `recordTrade(row, { buyer, hash })`, `recordOrderTrade(order, card, hash)`, and the `feeFor` / `royaltyFor` math (currently [tx.ts:550-567](apps/api/src/routes/tx.ts:550)). |
| `data/listings.ts` | `listingWithCard(id)`, `markSold`, `setContractListingId`, `markCancelled`. |
| `data/offers.ts` | offer lookups, `setContractOfferId`, `markSettled`, `markWithdrawn`. |
| `data/orders.ts` | `orderWithListingCard(id)`, status transitions, `setContractOrderId`. |

Scope is deliberate: **only** the queries/mutations used by reconciliation and the duplicated trade math move here. The build endpoints' one-off reads (e.g. a single `select` for a pre-flight) may stay inline — chasing a total repository abstraction would balloon the diff without serving the duplication goal. (A fuller repository is a possible follow-up, noted as out of scope.)

### Decision 4: Route file split under `routes/tx/`

```
routes/tx/
├── index.ts    composes sub-routers, exports `txRouter` (import site in index.ts unchanged or re-pointed)
├── build.ts    classic unsigned-XDR builds + /trustline + /quote-path + /path-payment
├── submit.ts   /submit, /submit-classic, /resolve  (calls settle.signed + reconcile)
└── passkey.ts  /passkey-deploy, /passkey-submit, /passkey-list, /passkey-order (calls settle.relayed + reconcile)
```

`index.ts` (the app entrypoint) keeps mounting a single `txRouter` at `/api/tx`; only its import path changes (or stays identical via a `routes/tx.ts` re-export barrel). Helpers shared across the split — `notFound`, `needContractId`, `requireCreatorTrustline` — move beside the data layer or into a small `routes/tx/shared.ts`.

**Why split by phase (build/submit/passkey) and not by domain (listings/offers/orders):** the duplication and the registry are organized around the build-vs-settle boundary; splitting by phase keeps each file's dependencies coherent (build.ts → stellar pre-flight; submit/passkey → settlement + registry) and mirrors how the two wallet worlds actually differ.

## Risks / Trade-offs

- **Reconciliation regression** is the main risk. Mitigation: port one `TradeAction` at a time, diffing each reconciler against the original switch arm; keep the idempotency guards verbatim; rely on `pnpm typecheck` for the registry's exhaustiveness and on manual end-to-end of one classic and one passkey flow.
- **`actor` semantics** must stay correct: classic `buy_now` buyer is the **tx source** ([tx.ts:637](apps/api/src/routes/tx.ts:637)); passkey buyer is the **`C…` address** ([tx.ts:729](apps/api/src/routes/tx.ts:729)). The registry takes `actor` precomputed by the caller so this distinction is explicit at the call site, not hidden.
- **Over-abstraction risk**: deliberately bounded — no Command classes, no WalletAdapter, no full repository, no DI. Only the proven-duplicated reconcile/settle/trade logic is extracted.

## Migration Plan

Incremental and reversible at each step (no DB or contract migration):
1. Land `data/` and `settlement/` modules with no caller changes (pure additions).
2. Re-point the classic `/submit` switch arms to call the registry, one action at a time; delete each arm as it goes live.
3. Re-point the passkey handlers to `settle.relayed` + registry.
4. Split the remaining endpoints into `build.ts` / `submit.ts` / `passkey.ts`, compose in `routes/tx/index.ts`, delete the old `tx.ts`.
5. Typecheck + manual smoke of one classic and one passkey path end-to-end.

## Open Questions

- Keep a `routes/tx.ts` re-export barrel for a zero-diff import in `index.ts`, or update the import to `routes/tx/index.js`? (Leaning re-export to minimize the entrypoint diff.)
- Should `requireCreatorTrustline` (a build-time pre-flight, not reconciliation) live in `routes/tx/shared.ts` or move toward `stellar.ts`? (Leaning `shared.ts` — it is route-orchestration glue, not a Stellar primitive.)

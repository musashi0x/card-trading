## 1. Data / repository layer (pure additions, no caller changes yet)

- [x] 1.1 Create `data/trades.ts` with `feeFor` / `royaltyFor` (ported verbatim from `tx.ts:550-567`), `recordTrade(row, { buyer, hash })`, and `recordOrderTrade(order, card, hash)`.
- [x] 1.2 Create `data/listings.ts` with `listingWithCard(id)` (ported from `getListingWithCard`), `markSold`, `markCancelled`, `setContractListingId`.
- [x] 1.3 Create `data/offers.ts` with offer lookup, `setContractOfferId`, `markSettled`, `markWithdrawn`.
- [x] 1.4 Create `data/orders.ts` with `orderWithListingCard(id)` (ported from `getOrderWithListingCard`), `setContractOrderId`, and `funded/shipped/disputed/released/refunded` transitions.
- [x] 1.5 `pnpm --filter @cardmkt/api typecheck` — modules compile and are unused so far.

## 2. Settlement envelope

- [x] 2.1 Create `settlement/settle.ts` exporting `Settlement = { hash, returnValue, successful: true }`.
- [x] 2.2 Implement `signed(signedXdr)` wrapping `submitSignedTx`, throwing the shared `TX_FAILED` `PreflightError` on `!successful`.
- [x] 2.3 Implement `relayed(signedXdr)` wrapping `relaySubmitter().submit` + `transactionReturnValue(hash)` for the return value, throwing `TX_FAILED` on `!successful`.
- [x] 2.4 Add a `txSource(signedXdr)` helper (the inner/outer source logic from `tx.ts:582`) for deriving the classic buyer-of-record.

## 3. Reconciliation registry (the keystone)

- [x] 3.1 Create `settlement/reconcile.ts` with `ReconcileCtx { refId, hash, returnValue, actor }` and a `Record<TradeAction, (c) => Promise<void>>` table; export `reconcile(action, ctx)`.
- [x] 3.2 Port `list`, `make_offer`, `cancel_listing`, `withdraw_offer` reconcilers from the `/submit` switch, delegating to `data/`.
- [x] 3.3 Port `accept_offer` and `buy_now` reconcilers; `buy_now` uses `ctx.actor` as buyer (replaces the inline `source`/`input.buyer` split). Verify `recordTrade` matches both old call sites.
- [x] 3.4 Port `purchase_escrow`, `mark_shipped`, `dispute` reconcilers.
- [x] 3.5 Port `confirm_receipt` / `claim_timeout`, preserving the `status !== 'released'` idempotency guard verbatim.
- [x] 3.6 Confirm TypeScript enforces every `TradeAction` key is present (exhaustiveness).

## 4. Rewire submit paths to the registry

- [x] 4.1 Rewrite classic `/submit` to `settle.signed` + `reconcile(action, { …, actor: txSource(xdr) })`; delete the `switch(action)` block.
- [x] 4.2 Rewrite `/passkey-submit` to `settle.relayed` + `reconcile`, passing `actor: input.buyer`; remove inline buy_now/make_offer reconciliation.
- [x] 4.3 Rewrite `/passkey-list` to `settle.relayed` + `reconcile('list', …)`; remove inline listing insert/return-value recovery.
- [x] 4.4 Rewrite `/passkey-order` to `settle.relayed` + `reconcile` for `purchase_escrow` and the existing-order actions; remove inline reconciliation.
- [x] 4.5 Keep `/resolve` (arbiter, server-signed) using `signAndSubmitAs`; route its DB updates through `data/orders.ts` + `recordOrderTrade`.

## 5. Split route files

- [x] 5.1 Create `routes/tx/build.ts` with the classic build endpoints (`/list`, `/cancel`, `/make-offer`, `/withdraw-offer`, `/accept-offer`, `/buy-now`, `/purchase-escrow`, `/mark-shipped`, `/confirm-receipt`, `/dispute`, `/claim-timeout`, `/trustline`, `/quote-path`, `/path-payment`) and their build-time pre-flights.
- [x] 5.2 Create `routes/tx/submit.ts` (`/submit`, `/submit-classic`, `/resolve`) and `routes/tx/passkey.ts` (`/passkey-deploy`, `/passkey-submit`, `/passkey-list`, `/passkey-order`).
- [x] 5.3 Move shared helpers (`notFound`, `needContractId`, `requireCreatorTrustline`) into `routes/tx/shared.ts`.
- [x] 5.4 Create `routes/tx/index.ts` composing the sub-routers into `txRouter`; add a `routes/tx.ts` re-export barrel (or re-point the import in `src/index.ts`).
- [x] 5.5 Delete the original monolithic `routes/tx.ts` body once all endpoints are migrated.

## 6. Verification

- [x] 6.1 `pnpm --filter @cardmkt/api typecheck` and `pnpm --filter @cardmkt/api build` pass.
- [x] 6.2 Diff each new reconciler against the original `/submit` switch arm and passkey inline block to confirm identical DB effects (status transitions, trade fields, contract-id writes).
- [x] 6.3 Manual smoke — one classic flow end-to-end (list → buy_now → trade row) and one passkey flow (passkey-list → passkey-submit buy_now), confirming identical DB rows and the same `{ hash, successful }` responses.
- [x] 6.4 Confirm no route path, request schema, response shape, or error code changed (grep the endpoints against the pre-refactor `tx.ts`).
- [x] 6.5 Confirm the indexer still reconciles (no overlap/regression with the registry's inline reconciliation).

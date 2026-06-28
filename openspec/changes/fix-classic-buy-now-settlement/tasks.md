## 1. Wire classic-wallet digital buy-now (USDC branch)

- [x] 1.1 In `TopDeckProvider.tsx` `buyNow()`, replace the USDC stub (the `!def?.asset` branch that sets `won` + toast) with a call to `wallet.runAction('buy_now', { listingId, buyer: address })`
- [x] 1.2 Set the `won` state and success toast only after `runAction` resolves with a confirmed tx hash; store `lastHash`
- [x] 1.3 On error, surface the message (reuse the `ApiRequestError` handling pattern from `escrowBuy`/`payWithPasskey`) and do not mark the card owned
- [x] 1.4 Guard the call on a real, contract-backed listing (`c.real`, `c.contractListingId != null`, `c.listingId`), consistent with the other buy handlers

## 2. Wire the non-USDC branch to settle after conversion

- [x] 2.1 In `buyNow()`, after `await payWithAsset(quote)` resolves, call `wallet.runAction('buy_now', { listingId, buyer: address })` instead of immediately showing success
- [x] 2.2 Move the success toast/state to after the settlement confirms
- [x] 2.3 Keep `payWithAsset` single-responsibility (convert only); do not chain settlement inside it

## 3. Stranded-buyer safeguards (pay-with-any-asset seam)

- [x] 3.1 Before building the conversion, re-fetch the listing and abort if it is not open (surface a "no longer available" message, spend nothing)
- [x] 3.2 On a settlement failure *after* the conversion confirmed, do not show success; detect whether the error is terminal (`NotOpen`/`SelfTrade`) or retryable
- [x] 3.3 For a terminal failure, inform the buyer they hold the converted USDC and offer to apply it to another card
- [x] 3.4 For a retryable failure, offer a `buy_now` retry that does not re-convert (USDC already held)
- [x] 3.5 Add the residual/retry UI affordance on `card/[id]/page.tsx` (message + retry action), driven by `payErr`/new state

## 4. API: reject closed listings on buy-now build

- [x] 4.1 Add an open-listing read/guard helper in `apps/api/src/data/listings.ts` (e.g. `requireOpenListing` or a status check in `listingWithCard` callers)
- [x] 4.2 In `build.ts` `POST /buy-now`, return a `LISTING_CLOSED` `PreflightError` when `listing.status !== 'open'`, before `contract.buyNow`
- [x] 4.3 Map `LISTING_CLOSED` to a clear client message in the web error handling

## 5. API: stop orphaning escrow orders

- [x] 5.1 Decide insert-on-reconcile vs. build-time-insert-plus-sweep (see design Decision 6) and document the choice — **chose sweep** (insert-on-reconcile would require re-keying the `refId` correlation)
- [~] 5.2 ~~If insert-on-reconcile~~ — N/A, sweep approach chosen instead (see 5.3)
- [x] 5.3 If sweep: add a cleanup that removes `funded` orders with `contractOrderId = null` (and `escrowTxHash = null`) older than the chosen TTL (`sweepAbandonedOrders`, 15min)
- [x] 5.4 Verify an abandoned escrow sign no longer leaves a permanent `funded` row and the listing stays purchasable

## 6. Validation & testing

- [x] 6.1 API test: `POST /api/tx/buy-now` returns `LISTING_CLOSED` for a sold/cancelled listing and builds for an open one (`buy.test.ts`, passing)
- [x] 6.2 API test: abandoned `purchase_escrow` does not persist a permanent orphan order; confirmed one persists (`buy.test.ts` `sweepAbandonedOrders`, passing)
- [~] 6.3 Web: classic USDC buy-now submits a real tx and only shows success after confirmation — code-complete + `tsc --noEmit` clean; **not yet run in a live browser**
- [~] 6.4 Web: non-USDC buy-now converts then settles — code-complete + typechecked; **not yet run in a live browser**
- [~] 6.5 Web: listing taken between conversion and settlement → residual-USDC + apply-to-another-card path — code-complete + typechecked; **not yet manually simulated**
- [~] 6.6 Regression: passkey Face ID buy-now and physical escrow paths unchanged — those handlers untouched; full API suite (55 tests) + `tsc` green; **not yet run in a live browser**

## 1. Shared types & schemas

- [ ] 1.1 Add a shared `StellarAsset` shape (code + issuer, with a sentinel for native XLM) and a `usdc` reference helper if not already exported
- [ ] 1.2 Add `PathQuoteRequest` / `PathQuoteResponse` types: source asset, destination USDC amount, estimated `sendAmount`, `sendMax`, `slippageBps`, and the discovered `path` (ordered asset list)
- [ ] 1.3 Add a `PathPaymentBuildRequest` type (buyer, source asset, destination USDC amount, accepted `sendMax`, path) and reuse `BuildTxResponse`
- [ ] 1.4 Add zod input schemas for the quote and path-payment build requests
- [ ] 1.5 Export the new types/schemas from `packages/shared` and add `MISSING_TRUSTLINE` / `INSUFFICIENT_BALANCE` / `NO_PATH` to the documented `ApiError` codes

## 2. API — Horizon path finding & builders

- [ ] 2.1 In `apps/api/src/stellar.ts`, add `findStrictReceivePath(buyer, sourceAsset, usdcAmount)` using the Horizon `strictReceivePaths` endpoint; return the cheapest route or signal `NO_PATH`
- [ ] 2.2 Add a `withSlippage(sourceAmount, slippageBps)` helper computing `sendMax = sourceAmount × (1 + slippageBps/10_000)`; read a default slippage bps from env
- [ ] 2.3 Add `buildPathPaymentTx(buyer, sourceAsset, usdcDestAmount, sendMax, path)` returning unsigned XDR for a `PathPaymentStrictReceive` whose destination is the buyer
- [ ] 2.4 Add `buildChangeTrustTx(account, asset)` returning unsigned XDR for a USDC `change_trust` op
- [ ] 2.5 Add `requireSourceBalance(buyer, sourceAsset, sendMax)` mirroring the existing `requireBalance`, raising a `PreflightError('INSUFFICIENT_BALANCE')`

## 3. API — endpoints

- [ ] 3.1 Add `POST /tx/quote-path` in `src/routes/tx.ts`: validate input, find the path, apply slippage, return the quote (or `NO_PATH`)
- [ ] 3.2 Add `POST /tx/path-payment`: pre-flight (USDC trustline → `MISSING_TRUSTLINE` + `change_trust` build; source balance → `INSUFFICIENT_BALANCE`), then return the path-payment build
- [ ] 3.3 Compute the conversion amount as `max(0, amountNeeded − currentUsdcBalance)` so an existing partial USDC balance reduces the conversion; short-circuit when the buyer already holds enough USDC

## 4. Web — asset picker & conversion flow

- [ ] 4.1 In `apps/web` lib, add API client calls for `quote-path` and `path-payment`
- [ ] 4.2 Add a source-asset picker to the buy/offer modal, defaulting to USDC (preserving current behavior)
- [ ] 4.3 On non-USDC selection, fetch and render a live quote line ("You pay ~X SOURCE → seller receives Y USDC") with the slippage cap
- [ ] 4.4 Sequence the confirm action: optional `change_trust` sign → path-payment sign+submit → existing `buy_now` / `accept_offer` step; skip conversion when USDC already suffices
- [ ] 4.5 Surface `MISSING_TRUSTLINE`, `INSUFFICIENT_BALANCE`, and `NO_PATH` as actionable UI states

## 5. Scripts & end-to-end

- [ ] 5.1 In setup, ensure an XLM↔USDC path exists on the test network (offers/liquidity) so the demo always has a route
- [ ] 5.2 Extend `packages/scripts/src/e2e.ts`: a buyer holding only XLM quotes, converts via path payment, and completes `buy_now`; assert the seller receives USDC and the buyer's XLM decreased within `sendMax`
- [ ] 5.3 Add an e2e assertion that a USDC-holding buyer skips the conversion step

## 6. Verification

- [ ] 6.1 Run the API + web locally and complete a pay-with-XLM purchase end to end
- [ ] 6.2 Run the e2e script and confirm both the convert-then-settle and the skip-conversion paths pass
- [ ] 6.3 `openspec validate pay-with-any-asset` passes and the diff is reviewed

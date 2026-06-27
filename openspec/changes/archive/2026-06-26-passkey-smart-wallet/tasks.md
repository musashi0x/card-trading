## 1. Setup & dependencies

- [x] 1.1 Add `passkey-kit` (and its WebAuthn/relay client deps) to `apps/web/package.json`; install — added `passkey-kit@^0.12.0` to web and api; `pnpm install` succeeded
- [x] 1.2 Add relay + passkey config to `apps/api` env (`apps/api/src/env.ts`): Launchtube endpoint/token, WebAuthn RP ID + origin, smart-wallet factory/WASM hash, Soroban RPC URL — added `env.passkey` (channels + launchtube + walletWasmHash + rpId)
- [x] 1.3 Document local HTTPS / fixed RP-ID requirement for WebAuthn in the change README or dev notes — see `openspec/changes/passkey-smart-wallet/README.md`

## 2. Verify contract supports a contract-address buyer

- [x] 2.1 Inspect `packages/contracts/src/lib.rs` `buy_now`/`make_offer`: confirm `require_auth(buyer)` and the USDC transfer work for a `C…` contract account (no classic-account assumptions) — buyer is plain `Address`; `require_auth` + USDC SAC `transfer` are Address-generic, so a contract account works unchanged
- [x] 2.2 Add/adjust a contract test in `packages/contracts/src/test.rs` exercising a contract-address buyer; regenerate affected `test_snapshots` — added `buy_now_settles_for_contract_address_buyer` + `make_offer_accepts_from_contract_address_buyer` (13 tests pass), snapshots generated
- [x] 2.3 If the contract assumes a classic buyer, make the minimal `Address`-preserving fix and rebuild/redeploy — not needed; no classic-only assumption exists

## 3. Shared types

- [x] 3.1 Add a smart-wallet/passkey account type and a passkey submit-request variant (host function + signed auth entries + optional deploy) to `packages/shared/src/types.ts` — added `SmartWalletAccount` + `PasskeySubmitRequest`
- [x] 3.2 Add zod schema(s) for the passkey submit request alongside the existing tx schemas — added `stellarContractAddress` + `passkeySubmitSchema`/`PasskeySubmitInput`

## 4. API — relay abstraction & submit path

- [x] 4.1 Define a `RelaySubmitter` interface (`submitSoroban({ func, auth, deploy? }) -> { hash, successful }`) in `apps/api/src/stellar.ts` (or a new `relay.ts`) — added `RelaySubmitter` in new `apps/api/src/relay.ts` (`submit(signedXdr) -> { hash, successful }`, matching passkey-kit's `send(xdr)`)
- [x] 4.2 Implement a Launchtube adapter for `RelaySubmitter`; stub/document an OpenZeppelin Channels adapter as the documented swap — implemented both; **Channels is the default** (Launchtube is legacy/superseded), selected via `PASSKEY_RELAY_PROVIDER`
- [x] 4.3 Add a passkey submit route in `apps/api/src/routes/tx.ts` that validates the request, submits via `RelaySubmitter`, and funnels into the existing DB reconciliation — added `POST /api/tx/passkey-submit`
- [x] 4.4 Record the smart-wallet `C…` address (not the relay/source account) as `buyer` in the `trades` reconciliation for `buy_now`/`make_offer` — `buy_now` inserts trade with `buyer: input.buyer`; `make_offer` inserts the offer row with the `C…` buyer
- [x] 4.5 On relay error/timeout, return a structured `ApiError` and leave listing/offer/trade state unchanged — `RelayError` (status 502, code `RELAY_FAILED`) thrown before any DB mutation; surfaced as `{ error, code }`

## 5. API — pre-flight for smart-wallet buyer

- [x] 5.1 Add a `C…`-buyer branch in `apps/api/src/stellar.ts` pre-flight: validate smart-wallet USDC funding for the amount — `requireSmartWalletUsdc` reads the USDC SAC `balance(C…)` via simulation
- [x] 5.2 Skip the classic `G…` trustline check for contract-account buyers — passkey path never calls `requireTrustline`/`requireBalance`
- [x] 5.3 Tolerate an undeployed smart wallet in pre-flight (no rejection solely for being undeployed) — unreadable balance is treated as unverifiable (warn + skip), not insufficient

## 6. Web — passkey wallet adapter

- [x] 6.1 Add a passkey wallet module wrapping `PasskeyKit`: create wallet, recover/connect, expose the `C…` address — `apps/web/src/lib/passkey.ts` (`connectPasskey`, `passkeySupported`/`passkeyConfigured`)
- [x] 6.2 Implement passkey signing of the marketplace call's Soroban auth entry (`buy_now`, `make_offer`) — `signBuyNow`/`signMakeOffer` build the op (shared `MarketplaceContract`), prepare, and `PasskeyKit.sign`
- [x] 6.3 Handle deploy-on-first-use: bundle deployment with the first authorized purchase — `takePendingDeploy()` relayed via `/api/tx/passkey-deploy` before the first call
- [x] 6.4 Track smart-wallet connection state distinctly from the classic keypair account — `WalletProvider` exposes `walletKind: 'classic' | 'passkey'` + the smart-wallet ref; `TopCard.contractListingId` added

## 7. Web — connect & checkout UX

- [x] 7.1 Add a "Pay with Face ID" / passkey option to the wallet-connect surface in `TopDeckApp`, alongside existing `@creit.tech/stellar-wallets-kit` connectors — top-nav "⚡ Face ID" pill + a "Pay with Face ID" button on the listing detail
- [x] 7.2 Feature-detect platform authenticator support; hide/disable the passkey option and fall back to the extension flow when unsupported — gated on `wallet.passkeyAvailable` (`passkeyEnabled()`)
- [x] 7.3 Implement the single-confirm checkout: biometric prompt → pending → success state for `buy_now`/`make_offer` — `payWithPasskey` connects-on-demand, shows `Confirming…`, then `won`/toast
- [x] 7.4 Handle declined biometric / submission failure as a cancellable, retryable state without marking the listing purchased — catch resets `paying`, sets `payErr`, leaves status untouched; button re-enables

## 8. End-to-end verification

- [ ] 8.1 Testnet run: create a passkey wallet (no seed phrase), confirm a `C…` address connects — **config wired** (.env + apps/web/.env.local: wasm hash, Channels relay key, funded FEE_SOURCE); needs a manual browser Face ID tap to verify
- [ ] 8.2 First purchase deploys the wallet and settles in one flow; verify the `trades` row records the smart wallet as buyer — **ready for manual run**; API passkey routes verified live + validating (`C…`-buyer enforced); 3 open listings have `contractListingId` (buyable)
- [ ] 8.3 Confirm gasless: a buyer with no XLM completes a purchase via the relay — **ready for manual run**; Channels relay key minted + FEE_SOURCE funded (9,999 XLM)
- [ ] 8.4 Regression: existing extension/keypair connect, list, and accept-offer flows still work unchanged — **ready for manual run**; change is additive — classic paths untouched
- [x] 8.5 Run `pnpm typecheck` and `pnpm lint` across affected packages — `pnpm typecheck` all 8 pass; contract `cargo fmt`/tests clean (13 pass). Note: `@cardmkt/web` `next lint` fails on a **pre-existing** interactive ESLint-setup prompt, unrelated to this change

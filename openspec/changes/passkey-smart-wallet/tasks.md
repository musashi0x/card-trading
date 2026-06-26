## 1. Setup & dependencies

- [ ] 1.1 Add `passkey-kit` (and its WebAuthn/relay client deps) to `apps/web/package.json`; install
- [ ] 1.2 Add relay + passkey config to `apps/api` env (`apps/api/src/env.ts`): Launchtube endpoint/token, WebAuthn RP ID + origin, smart-wallet factory/WASM hash, Soroban RPC URL
- [ ] 1.3 Document local HTTPS / fixed RP-ID requirement for WebAuthn in the change README or dev notes

## 2. Verify contract supports a contract-address buyer

- [ ] 2.1 Inspect `packages/contracts/src/lib.rs` `buy_now`/`make_offer`: confirm `require_auth(buyer)` and the USDC transfer work for a `C…` contract account (no classic-account assumptions)
- [ ] 2.2 Add/adjust a contract test in `packages/contracts/src/test.rs` exercising a contract-address buyer; regenerate affected `test_snapshots`
- [ ] 2.3 If the contract assumes a classic buyer, make the minimal `Address`-preserving fix and rebuild/redeploy

## 3. Shared types

- [ ] 3.1 Add a smart-wallet/passkey account type and a passkey submit-request variant (host function + signed auth entries + optional deploy) to `packages/shared/src/types.ts`
- [ ] 3.2 Add zod schema(s) for the passkey submit request alongside the existing tx schemas

## 4. API — relay abstraction & submit path

- [ ] 4.1 Define a `RelaySubmitter` interface (`submitSoroban({ func, auth, deploy? }) -> { hash, successful }`) in `apps/api/src/stellar.ts` (or a new `relay.ts`)
- [ ] 4.2 Implement a Launchtube adapter for `RelaySubmitter`; stub/document an OpenZeppelin Channels adapter as the documented swap
- [ ] 4.3 Add a passkey submit route in `apps/api/src/routes/tx.ts` that validates the request, submits via `RelaySubmitter`, and funnels into the existing DB reconciliation
- [ ] 4.4 Record the smart-wallet `C…` address (not the relay/source account) as `buyer` in the `trades` reconciliation for `buy_now`/`make_offer`
- [ ] 4.5 On relay error/timeout, return a structured `ApiError` and leave listing/offer/trade state unchanged

## 5. API — pre-flight for smart-wallet buyer

- [ ] 5.1 Add a `C…`-buyer branch in `apps/api/src/stellar.ts` pre-flight: validate smart-wallet USDC funding for the amount
- [ ] 5.2 Skip the classic `G…` trustline check for contract-account buyers
- [ ] 5.3 Tolerate an undeployed smart wallet in pre-flight (no rejection solely for being undeployed)

## 6. Web — passkey wallet adapter

- [ ] 6.1 Add a passkey wallet module wrapping `PasskeyKit`: create wallet, recover/connect, expose the `C…` address
- [ ] 6.2 Implement passkey signing of the marketplace call's Soroban auth entry (`buy_now`, `make_offer`)
- [ ] 6.3 Handle deploy-on-first-use: bundle deployment with the first authorized purchase
- [ ] 6.4 Track smart-wallet connection state distinctly from the classic keypair account in `apps/web/src/components/topdeck/lib.ts`

## 7. Web — connect & checkout UX

- [ ] 7.1 Add a "Pay with Face ID" / passkey option to the wallet-connect surface in `TopDeckApp`, alongside existing `@creit.tech/stellar-wallets-kit` connectors
- [ ] 7.2 Feature-detect platform authenticator support; hide/disable the passkey option and fall back to the extension flow when unsupported
- [ ] 7.3 Implement the single-confirm checkout: biometric prompt → pending → success state for `buy_now`/`make_offer`
- [ ] 7.4 Handle declined biometric / submission failure as a cancellable, retryable state without marking the listing purchased

## 8. End-to-end verification

- [ ] 8.1 Testnet run: create a passkey wallet (no seed phrase), confirm a `C…` address connects
- [ ] 8.2 First purchase deploys the wallet and settles in one flow; verify the `trades` row records the smart wallet as buyer
- [ ] 8.3 Confirm gasless: a buyer with no XLM completes a purchase via the relay
- [ ] 8.4 Regression: existing extension/keypair connect, list, and accept-offer flows still work unchanged
- [ ] 8.5 Run `pnpm typecheck` and `pnpm lint` across affected packages

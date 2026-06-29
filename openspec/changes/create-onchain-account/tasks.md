## 1. Client wallet generation + funding lib

- [ ] 1.1 Add a `createGeneratedWallet()` helper in `apps/web/src/lib/wallet.ts` that calls `Keypair.random()` and returns `{ publicKey, keypair }` (secret stays in-memory, never sent to the API).
- [ ] 1.2 Add a `fundNewAccount(publicKey, signTx)` helper that drives the existing `/api/dev/fund-wallet` faucet flow: call `api.devFundWallet(address)` → on `MISSING_TRUSTLINE`, sign the returned `change_trust` XDR with the generated keypair and submit via `api.submitClassic` → call `api.devFundWallet(address)` again to mint the starter USDC. Mirror `apps/web/src/app/(marketplace)/faucet/page.tsx`. Reject with an actionable, retryable error on any step.
- [ ] 1.3 Add a `waitForAccountOnChain(publicKey)` helper that polls Horizon `loadAccount` (or `GET /api/dev/balance/:address`) with bounded retries + backoff (mirror the convergence-polling pattern from `loadBuildSource` in `apps/api/src/stellar.ts`), resolving only once the account exists; reuse it before the trustline step.
- [ ] 1.4 Add a local signer for generated wallets so `signXdr` can sign with the in-memory `Keypair` instead of opening the Wallets Kit modal when the active session is a generated wallet (used for both the `change_trust` tx and all marketplace txs).
- [ ] 1.5 Confirm via `GET /api/dev/balance/:address` that the account ends with non-zero XLM, a USDC trustline, and a non-zero USDC balance before marking onboarding complete.

## 2. WalletProvider integration

- [ ] 2.1 Add `createWallet()` (a.k.a. `connectViaNewAccount()`) to `apps/web/src/components/WalletProvider.tsx` that runs generate → friendbot-create/verify → USDC trustline → USDC mint, then `saveSession({ kind: 'classic', address, walletId })` and registers the in-memory signer.
- [ ] 2.2 Ensure connected state reports `walletKind: 'classic'` and routes `runAction`/tx-build identically to a connected Freighter account.
- [ ] 2.3 Handle funding/verification failures: surface the error and leave the user disconnected (do not `saveSession`); allow retry for the same generated address.
- [ ] 2.4 Adjust session restore (`apps/web/src/lib/wallet-session.ts`) so a generated-wallet session is NOT silently restored as signable when no secret is available — treat as disconnected / re-prompt.

## 3. Onboarding UI

- [ ] 3.1 Add a "Create a new wallet" entry point in the onboarding/connect UI (the TopDeck shell, e.g. `WalletMenu.tsx` / connect modal) beside "Connect Freighter" and "Pay with Face ID".
- [ ] 3.2 Wire the button to `WalletProvider.createWallet()` with loading, success, and retryable-error states.
- [ ] 3.3 Add the one-time secret-backup screen: show the generated secret with copy action and an explicit "I've backed this up" confirmation that gates first transaction.
- [ ] 3.4 Add testnet/non-custodial messaging clarifying the user holds the key and value-at-risk.

## 4. User record association

- [ ] 4.1 On successful create+fund+verify, proactively ensure the `users` row for the new address (reuse the `ensureUser` upsert pattern in `apps/api/src/routes/profiles.ts`, or call `GET /api/profiles/:address` to trigger lazy creation).
- [ ] 4.2 Confirm `GET /api/profiles/:address` returns `200` with default profile + `memberSince` for the new address.

## 5. Verification

- [ ] 5.1 Manually verify end-to-end on testnet: create wallet → XLM-funded → USDC trustline + starter USDC balance → verified on-chain → `users` row exists → complete a first card creation/list AND an auction offer/buy-now without `ACCOUNT_NOT_FOUND` or `MISSING_TRUSTLINE`/`INSUFFICIENT_BALANCE`.
- [ ] 5.2 Verify funding-failure path: simulate friendbot failure → user stays disconnected with a retryable error.
- [ ] 5.3 Verify reload behavior: reloading without an available secret does not present a connected, signable generated wallet.
- [ ] 5.4 Confirm no regression to the existing Freighter and passkey connect paths.

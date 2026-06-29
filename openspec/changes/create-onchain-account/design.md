## Context

The marketplace identifies users solely by their Stellar address (`users.stellar_address`
is the identity; there is no email/password/session). Today the only way to obtain
an address is to connect an existing wallet:

- **Classic path** (`apps/web/src/lib/wallet.ts` + `WalletProvider.tsx`): Stellar
  Wallets Kit opens a picker; the user must already have a funded `G…` account.
  Every API pre-flight calls `horizon.loadAccount(address)`, which throws
  `ACCOUNT_NOT_FOUND` (→ `PreflightError`, 400) if the account was never created
  on-chain.
- **Passkey path** (`apps/web/src/lib/passkey.ts`): `passkey-kit` `createWallet()`
  deploys a Soroban `C…` contract account. This is the only existing "create an
  account on-chain" flow, but it produces a contract account, not a classic
  keypair, and relies on a gasless relay.

There is **no faucet, no `Keypair.random()`, no `Operation.createAccount`, and no
friendbot call anywhere in the codebase** (confirmed in `apps/api/src/stellar.ts`).
A brand-new user with no wallet cannot enter classic flows at all.

This change adds a third onboarding path: generate a fresh classic `G…` keypair,
create + fund it on-chain via testnet friendbot, then connect it through the same
`WalletProvider` machinery so the rest of the workflow (build → sign → submit,
profiles, indexer) is unchanged. Per the proposal, the integration point is the
wallet-connect onboarding entry, sitting beside "Connect Freighter" and
"Pay with Face ID".

## Goals / Non-Goals

**Goals:**
- One-click creation of a new, funded Stellar testnet account during onboarding.
- The generated account is indistinguishable from a connected Freighter account
  for all downstream code (`walletKind: 'classic'`, signs XDR, has a `users` row).
- Verify the account exists on-chain (Horizon) before marking the user connected.
- Fund the account enough to immediately **create a card or attend an auction**:
  XLM reserves/fees + a USDC trustline + a starter USDC balance.
- Persist/ensure the `users` row for the new address so profiles/stats work.
- Make secret-key custody explicit and safe-by-default (user holds the key;
  backup prompt before they can transact).

**Non-Goals:**
- Production mainnet account creation / real XLM funding (testnet friendbot only).
- Custodial key storage on the server (the API never holds user secrets; that
  invariant is preserved).
- Replacing or changing the passkey or Freighter paths.
- Account recovery infrastructure beyond surfacing the secret for the user to
  back up.
- The buyer's per-card trustline (to receive a purchased card) — still handled by
  the existing trustline self-healing at buy time, not by this onboarding flow.

## Decisions

### Decision 1: Generate the keypair client-side, never on the server
`Keypair.random()` runs in the browser (`apps/web`). The secret never touches the
API. This preserves the codebase's core invariant ("the API never holds a user
private key") and keeps the generated wallet non-custodial.

- **Alternative considered**: server generates and returns the secret. Rejected —
  it makes the platform custodial, creates a secret-in-transit/at-rest liability,
  and breaks the existing security model.

### Decision 2: Fund via the existing `/api/dev/fund-wallet` faucet route
Rather than build a new funding path, reuse `apps/api/src/routes/dev.ts`
`POST /api/dev/fund-wallet`, which already does exactly what onboarding needs for
a classic `G…` account: if the account does not exist on-chain it calls friendbot
to create + XLM-fund it; if there is no USDC trustline it returns a `change_trust`
XDR for the client to sign; once the trustline exists it mints test USDC
(`mintUsdcTo`, signed server-side with the issuer secret — no key reaches the
browser). The account's balances/trustline can be read via `GET /api/dev/balance/:address`.

- **Alternative considered**: a client-direct friendbot call. Friendbot alone only
  delivers XLM — it does NOT establish the USDC trustline or seed USDC, so the
  account still could not attend an auction. The faucet route already chains all
  three steps, so we reuse it instead of reimplementing.
- **Alternative considered**: platform-issuer-funded `createAccount` (using
  `env.platformIssuer`). Rejected for onboarding — spends real platform XLM and
  serializes on `withIssuerLock`; reserved for mainnet follow-up.

### Decision 2b: Fund "enough to create a card or attend an auction"
The goal is that a freshly created account can immediately participate, not just
exist. That requires three things, all delivered by the faucet route + one
client-signed trustline tx:
- **XLM** (friendbot) — covers the base reserve plus the extra reserves consumed
  by trustlines/listings and per-tx fees, so the user can **create a card / list**
  (which adds a card-asset trustline + listing entry).
- **USDC trustline** (`change_trust`, signed by the generated keypair via
  `signXdr`, submitted through `api.submitClassic`) — required to hold USDC.
- **Starter USDC balance** (default 100 test USDC via `mintUsdcTo`) — so the user
  can **attend an auction / make an offer / buy-now** without a separate faucet trip.

The flow mirrors the existing faucet page (`apps/web/src/app/(marketplace)/faucet/page.tsx`):
call `devFundWallet` → on `MISSING_TRUSTLINE`, sign the returned `change_trust`
XDR with the generated keypair and submit → call `devFundWallet` again to mint.
The buyer's per-card trustline (to receive a purchased card) is still handled by
the existing trustline self-healing at buy time and is out of scope here.

### Decision 3: Verify on-chain before connecting
Friendbot is asynchronous relative to ledger close. After funding, poll
`horizon.loadAccount(address)` (bounded retries with backoff) until the account
resolves, then mark connected. This prevents the immediate `ACCOUNT_NOT_FOUND`
failure that would otherwise hit the first pre-flight. Reuse the
sequence-convergence polling pattern already in `loadBuildSource`.

### Decision 4: Reuse the classic connection state; add a new connect entrypoint
Add `createWallet()` (or `connectViaNewAccount()`) to `WalletProvider` that:
generates → funds → verifies → `saveSession({ kind: 'classic', address, walletId })`
and registers an in-memory signer (the generated `Keypair`) so `signXdr` for this
session signs locally instead of opening the Wallets Kit modal. Downstream
`runAction` / tx-build is untouched. The proposal references `TopDeckProvider.tsx`
(the onboarding shell); the actual connect logic lives in `WalletProvider.tsx` —
the new button is surfaced in the onboarding UI and calls into `WalletProvider`.

- **Alternative considered**: import the generated keypair into Freighter. Rejected —
  no programmatic import API; defeats the zero-prerequisite goal.

### Decision 5: Ensure the `users` row at connect time
On successful creation, call the existing `ensureUser`-style upsert (today it is
lazy on first `GET /api/profiles/:address`). For a generated account we proactively
ensure the row so the account immediately participates in profiles/stats. No schema
change — `users.stellar_address` already uniquely keys the identity.

### Decision 6: Secret-key custody UX
Because the key is generated in-session and the user has no extension holding it,
the secret MUST be shown once with an explicit "I've backed this up" confirmation,
and persisted only where the user opts in (e.g. session storage for the active
session, clearly labeled testnet). The session-restore path (`wallet-session.ts`,
1-day TTL) cannot silently resurrect a signer it doesn't have the secret for — so
on reload without a stored secret the user is treated as disconnected (or
re-prompted), matching the non-custodial model.

## Risks / Trade-offs

- **[Secret loss = funds/account loss]** → Generated account is non-custodial and
  testnet-only; force an explicit backup-acknowledgement before first transaction,
  and label the value-at-risk clearly. No silent server fallback.
- **[Friendbot unavailable / rate-limited]** → Surface an actionable, retryable
  error and do NOT mark the user connected; the keypair can be re-funded on retry
  since the address is deterministic from the secret held in-session.
- **[Funding race → first tx hits `ACCOUNT_NOT_FOUND`]** → Decision 3's bounded
  Horizon polling gates "connected" on actual on-chain existence.
- **[Secret in browser storage is a footgun if copied to mainnet]** → Keep network
  hardcoded to `TESTNET` (as in `wallet.ts`); scope any persisted secret to the
  session and gate behind the testnet build.
- **[Two “new wallet” paths (passkey vs generated keypair) confuse users]** →
  Position generated-keypair as the explicit "advanced / I want a seed-style
  account" path; passkey remains the recommended default. UX copy differentiates.

## Migration Plan

Purely additive — no DB migration, no change to existing endpoints. Rollout:
1. Ship `WalletProvider` creation method + onboarding button behind the existing
   testnet build.
2. Verify create → fund → verify → ensureUser → first `buy-now` end-to-end on
   testnet.
3. Rollback = hide the onboarding button; no data backfill or schema reversal
   needed.

## Open Questions

- Should the generated secret be offered as a downloadable backup / keystore file,
  or copy-to-clipboard only?
- Do we persist the encrypted secret for session-restore (1-day TTL like classic),
  or require re-entry/re-creation on reload? (Leaning: do not persist the raw
  secret; treat reload as disconnected unless the user re-imports.)
- Is a server-side friendbot proxy needed for CORS/rate-limiting, or is the direct
  client call sufficient on testnet?

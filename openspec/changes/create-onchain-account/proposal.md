## Why

Today a consumer can only enter the marketplace by connecting an existing
Freighter (or compatible) wallet. A first-time user with no Stellar account is
stuck at the door: they must leave, install an extension, create a keypair, and
fund it before they can browse or buy. We want a zero-prerequisite path that
generates a brand-new Stellar account on-chain and connects it during
onboarding, so a new user goes from "never used Stellar" to "connected and
funded" in one click.

## What Changes

- Add a "Create a new wallet" onboarding path alongside the existing
  connect-Freighter flow, surfaced from the wallet-connect entry point.
- Generate a fresh Stellar `G…` keypair client-side during onboarding.
- Create and fund the account on-chain on testnet via friendbot (XLM for
  reserves + fees), then verify the account exists on the ledger before treating
  the user as connected.
- Fund the account well enough to immediately **create a card or attend an
  auction**: establish a USDC trustline and seed a starter USDC balance, reusing
  the existing `/api/dev/fund-wallet` faucet route (friendbot → `change_trust` →
  mint test USDC) so the generated account can list/create and make offers/buy
  without any extra faucet trip.
- Persist the resulting public key into the existing `users` record so the
  generated account participates in the same workflow as a connected Freighter
  account (profiles, listings, trades, indexer).
- Securely surface/store the secret key for the generated wallet so the user can
  authorize transactions and recover the account, with explicit backup
  messaging (testnet, non-custodial by default).
- Wire the new account into `TopDeckProvider` so the connected-account state,
  signing, and downstream tx-build flow treat a generated account identically to
  a connected wallet.

## Capabilities

### New Capabilities
- `generated-wallet-onboarding`: Generate a new Stellar keypair, create and fund
  the account on-chain via friendbot, verify it on the ledger, persist its
  public key, and connect it through the existing wallet-connect onboarding flow.

### Modified Capabilities
<!-- No existing spec's requirements change; this is purely additive onboarding. -->

## Impact

- **Frontend**: `apps/web/src/components/topdeck/TopDeckProvider.tsx` (connect
  state, signing source), the wallet-connect UI entry point, and any
  onboarding/connect modal.
- **API**: reuse the existing `apps/api/src/routes/dev.ts` `/api/dev/fund-wallet`
  route (friendbot create + USDC trustline + `mintUsdcTo`) and `/api/dev/balance`,
  plus association of the new public key with the `users` table. No new account
  endpoint expected.
- **DB**: a `users` row is created/ensured for the generated address (reuses the
  existing user model; no schema change expected).
- **Chain**: friendbot account creation + XLM funding on Stellar testnet; USDC
  trustline (`change_trust`, signed client-side) + test-USDC mint; account
  existence verification via Horizon.
- **Dependencies**: Stellar SDK keypair generation and Horizon/friendbot access
  already present in `apps/api/src/stellar.ts`.
- **Security**: secret-key handling and backup UX for the generated wallet.

## 1. Monorepo Scaffolding

- [x] 1.1 Initialize pnpm + turbo workspace with `pnpm-workspace.yaml` and root `turbo.json`
- [x] 1.2 Create `packages/shared` (TS types, zod schemas, asset codec, Stellar SDK tx-builder helpers)
- [x] 1.3 Create `packages/db` (Drizzle config, Postgres connection)
- [x] 1.4 Create `packages/contracts` (Soroban Rust crate scaffold)
- [x] 1.5 Create `apps/api` (Express + TypeScript) and `apps/web` (Next.js) app shells
- [x] 1.6 Add shared lint/tsconfig base and wire turbo pipelines (build, dev, lint)

## 2. Stellar Foundation (front-load — slowest loop)

- [x] 2.1 Set up Rust + Soroban CLI toolchain and confirm testnet access
- [x] 2.2 Create a platform issuer account and fund test accounts via friendbot (run live on testnet)
- [x] 2.3 Issue a test USDC-equivalent stablecoin asset on testnet (run live)
- [x] 2.4 Issue 5–10 sample card assets on testnet with defined supply (6 cards issued)
- [x] 2.5 Implement card ↔ asset codec (card id ↔ assetCode/issuer) in `packages/shared`

## 3. Soroban Settlement Contract

- [x] 3.1 Define contract storage and types (listings, offers, fee, platform account)
- [x] 3.2 Implement `init` with platform account and fee rate
- [x] 3.3 Implement `list` (lock card into custody) and `cancel_listing` (return card, seller-only)
- [x] 3.4 Implement `make_offer` (lock USDC) and `withdraw_offer` (return USDC if unaccepted)
- [x] 3.5 Implement atomic `accept_offer` settlement (card→buyer, USDC−fee→seller, fee→platform)
- [x] 3.6 Implement `buy_now` reusing the settlement path at asking price
- [x] 3.7 Write contract unit tests covering settlement, refund, and authorization rejections (6/6 pass)
- [x] 3.8 Build, deploy to testnet, and record the contract address (live: CA72LFSM…NBKBG)

## 4. Database Layer

- [x] 4.1 Define Drizzle schema: `users`, `cards`, `listings`, `offers`, `trades`
- [x] 4.2 Generate and run migrations against Postgres (applied)
- [x] 4.3 Seed cards (metadata + images) for the issued sample assets (seed script ready)

## 5. Backend API

- [x] 5.1 Cards/listings catalog + search endpoints (served from Postgres)
- [x] 5.2 Transaction-build endpoints for list, cancel, make-offer, withdraw-offer, accept-offer, buy-now (return unsigned txns; no key custody)
- [x] 5.3 Pre-flight validation (trustline exists, sufficient balance) with actionable errors
- [x] 5.4 Transaction submit endpoint (accept signed XDR, submit to network)
- [x] 5.5 Chain indexer: reconcile listing/offer/settlement state into Postgres (poll-on-action + interval)
- [x] 5.6 Trade history endpoint including settlement transaction hashes

## 6. Frontend Web App

- [x] 6.1 Freighter wallet connect + connected-address display (+ not-installed guidance)
- [x] 6.2 Marketplace browse + search UI (card image, name, rarity, price in test USDC)
- [x] 6.3 List-a-card flow (select owned card, set price, sign `list`)
- [x] 6.4 Trustline prompt when buyer lacks a trustline to a card
- [x] 6.5 Make-offer and withdraw-offer flows with escrow status display
- [x] 6.6 Accept-offer (seller) and buy-now (buyer) flows
- [x] 6.7 Trade history view with block-explorer links per settlement

## 7. Integration & Demo

- [x] 7.1 End-to-end test of the offer→accept hero flow on testnet
- [x] 7.2 End-to-end test of the buy-now flow on testnet
- [x] 7.3 Verify the withdraw-offer consumer-protection beat (funds returned)
- [x] 7.4 Seed demo listings and prepare two funded demo wallets (merchant + consumer)
- [x] 7.5 Write README with setup steps and the 2-minute demo script

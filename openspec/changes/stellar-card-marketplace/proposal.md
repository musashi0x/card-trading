## Why

Trading card marketplaces force buyers and sellers to trust either each other or a custodial middleman that holds funds, sets opaque fees, and can freeze payouts. For the **Consumer & Merchant Payment Flows** track, Stellar lets us remove that trust gap entirely: a buyer's payment can sit in non-custodial on-chain escrow, settle atomically against the card the instant a merchant accepts, and refund itself if the deal falls through — with a transparent platform fee skimmed on settlement. This change builds that marketplace end to end.

## What Changes

- **Cards become on-chain Stellar assets.** Each card is a Stellar Asset (wrapped as a Stellar Asset Contract / SAC) so the escrow contract can move it through the standard token interface. Rich metadata (name, set, rarity, image) lives off-chain in Postgres.
- **One focused Soroban escrow/settlement contract.** Implements a single "lock asset until condition" primitive exposing `list`, `cancel_listing`, `make_offer`, `withdraw_offer`, `accept_offer`, and `buy_now`. Settlement is atomic (card → buyer, USDC → seller, fee → platform) in one transaction.
- **Unified offer primitive.** Buy-it-now is modeled as an offer at the asking price with auto-accept, so both buy-now and offer/bid UX flow through the same contract path.
- **Consumer payment protection.** Buyer funds locked in escrow can be pulled back via `withdraw_offer` any time before a merchant accepts — funds are never at risk while an offer is open.
- **Express + Postgres marketplace backend.** Listings, offers, trades, and card metadata CRUD + search, plus a chain indexer that reconciles on-chain settlement events into a read-optimized Postgres mirror (chain is source of truth for ownership/money).
- **Next.js trading UI with wallet connect.** Browse/search cards, list a card, make/withdraw an offer, accept an offer, and buy now — signing transactions via a Stellar wallet (Freighter). Trade history links to a block explorer.
- **Monorepo scaffolding.** pnpm + turbo workspace wiring the web app, API, contract, db, and shared packages together.

## Capabilities

### New Capabilities
- `card-assets`: Representing trading cards as on-chain Stellar assets with off-chain metadata, and minting/issuing them on testnet.
- `marketplace-settlement-contract`: The Soroban escrow/settlement contract — listing custody, offer escrow, atomic settlement, refunds, and platform fee.
- `marketplace-api`: Express + Postgres/Drizzle backend for listings, offers, trades, search, and the chain indexer/reconciliation.
- `marketplace-web`: Next.js frontend for browsing, listing, offering, and settling trades, including Stellar wallet connection and transaction signing.

### Modified Capabilities
<!-- None — greenfield project. -->

## Impact

- **New monorepo** (pnpm + turbo): `apps/web` (Next.js), `apps/api` (Express), `packages/contracts` (Soroban/Rust), `packages/db` (Drizzle + Postgres), `packages/shared` (TS types, Stellar SDK helpers, asset codec, zod schemas).
- **External dependencies**: Stellar SDK (`@stellar/stellar-sdk`), Soroban CLI + Rust toolchain, Freighter wallet API, Postgres, a test USDC-equivalent stablecoin asset on Stellar testnet.
- **Network**: Stellar testnet (Soroban-enabled). No mainnet / real USDC in scope.
- **Out of scope for hackathon**: physical card shipping/redemption, fiat on/off ramps (SEP-24 anchors), production-grade indexer streaming, multi-currency path payments (USDC-only pricing).

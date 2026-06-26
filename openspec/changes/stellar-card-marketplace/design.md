## Context

This is a greenfield hackathon project for the **Consumer & Merchant Payment Flows** track. The product is a trading card marketplace where cards are on-chain Stellar assets and the payment experience — non-custodial escrow, atomic settlement, transparent fees, and instant refunds — is the centerpiece. Hard constraints: short build window (favor focus over completeness), Stellar testnet only, and the stack is fixed (pnpm + turbo monorepo, Next.js, Express, Postgres + Drizzle, one Soroban contract).

The central architectural principle: **the chain is the source of truth for ownership and money; Postgres is a read-optimized mirror** for search, metadata, and history. The Soroban contract holds value and settles trades; the backend never custodies funds.

## Goals / Non-Goals

**Goals:**
- One focused Soroban contract that escrows assets and settles trades atomically with a platform fee.
- A unified offer primitive so buy-now and offer/bid share one settlement path.
- Visible consumer payment protection: locked offer funds are refundable until acceptance.
- A demo where every money movement is verifiable on a block explorer.
- A clean monorepo where contract, API, web, and shared types stay in sync.

**Non-Goals:**
- Physical card shipping, redemption, or delivery confirmation.
- Fiat on/off ramps (SEP-24 anchors) and real USDC (mainnet).
- Multi-asset path payments — pricing is USDC-only for the demo.
- Production-grade event streaming, high-availability indexing, or auth hardening.
- On-chain card minting logic (cards are issued via classic Stellar, not minted by the contract).

## Decisions

### Decision 1: Cards as classic Stellar assets (SAC), not contract-native NFTs
Each card is a Stellar Asset (`assetCode` + issuer), wrapped as a Stellar Asset Contract so it implements the standard token interface. The escrow contract then moves cards and USDC through the *same* interface.
- **Why:** Keeps the Soroban contract truly focused on escrow/settlement — it speaks one token interface for both legs. Minting/issuing is a classic Stellar operation (no Rust, instant, free on testnet). Semi-fungibility (multiple copies of one card) is realistic for trading cards.
- **Alternatives considered:** (a) Contract-native NFT — blurs the "focused escrow" scope and adds Rust; (b) separate NFT contract + escrow contract — most "correct" but doubles the contract surface to build and test under time pressure.

### Decision 2: One contract, one "lock asset until condition" primitive
The contract exposes `list`, `cancel_listing`, `make_offer`, `withdraw_offer`, `accept_offer`, `buy_now`. Listing locks the seller's card; making an offer locks the buyer's USDC. Settlement transfers card → buyer, USDC → seller minus fee, fee → platform, in one atomic transaction.
- **Why:** Buy-now is just "an offer at the asking price that auto-accepts," so both UX flows reuse the same settlement code. Fewer code paths to test; the escrow mechanism is exercised by both flows.
- **Alternatives considered:** Separate buy-now and offer code paths — more surface area, more bugs, no benefit.

### Decision 3: Chain is truth, Postgres is a mirror reconciled by an indexer
The backend writes intent (draft listings, metadata) but treats on-chain state as authoritative for ownership and funds. An indexer polls the contract / settlement events and updates `listings`, `offers`, and `trades` rows.
- **Why:** Avoids the classic dual-write inconsistency. The demo can always fall back to "what does the chain say." Search and images stay fast because they're served from Postgres.
- **Alternatives considered:** DB-as-truth (custodial, defeats the point); pure on-chain reads for every page (too slow, poor UX).

### Decision 4: Poll-on-action indexing, not streaming
The indexer reconciles after each user action and on a lightweight interval, rather than maintaining a persistent event stream.
- **Why:** Streaming infra is over-engineering for a demo and a common time sink. Polling after a known action gives near-instant UI updates where it matters.
- **Alternatives considered:** Full event-streaming indexer — higher reliability, far higher build cost; cut for the hackathon.

### Decision 5: Freighter for wallet + signing; backend builds, wallet signs, backend submits
The frontend connects Freighter. Transactions are built server-side (or in shared helpers), signed in the wallet, and submitted to the network. The backend holds no user keys.
- **Why:** Standard, well-documented Stellar wallet; keeps signing client-side and non-custodial.
- **Alternatives considered:** Custodial server-side signing — simpler but contradicts the non-custodial payment narrative that is the whole pitch.

### Decision 6: A `packages/shared` package for types, asset codec, and SDK helpers
Card asset encoding (card ↔ assetCode/issuer), zod schemas, and Stellar SDK transaction builders live in one shared package consumed by both web and api.
- **Why:** Prevents drift between frontend and backend on the asset format and tx-building logic — a frequent source of bugs in monorepos.

## Risks / Trade-offs

- **Soroban dev loop is slow / Rust toolchain friction** → Scaffold, build, and deploy the contract to testnet on day 1 before any UI work; keep the contract interface tiny and stable.
- **Wallet signing flakiness (Freighter)** → Build and manually test the connect+sign+submit round trip end-to-end early; have a known-good test account funded via friendbot.
- **No real USDC on testnet** → Issue a test stablecoin asset that mimics USDC; clearly label it as test currency in the UI.
- **Indexer reconciliation drift** → Keep it dumb: re-derive state from chain on each action; never let the DB override the chain.
- **Scope creep into offers/bids/auctions** → Ship buy-now path first end-to-end, then layer offer/accept; both share the contract, so the increment is small but bounded.
- **Atomic settlement edge cases (insufficient trustline, missing balance)** → Pre-flight checks in the API (trustline exists, balance sufficient) before asking the user to sign; surface clear errors.

## Migration Plan

Greenfield — no migration. Deployment order: (1) issue test USDC + sample card assets on testnet; (2) build/deploy the Soroban contract, record its address; (3) wire the API + Drizzle schema and run migrations against Postgres; (4) connect the web app; (5) seed sample listings for the demo. Rollback for the demo = redeploy contract to a fresh address and re-seed.

## Open Questions

- Should the platform fee be a fixed bps in the contract or configurable at init? (Lean: set at contract init for transparency, no admin mutability in demo.)
- Do we need offer expiry/timeouts for the demo, or is manual `withdraw_offer` enough? (Lean: manual withdraw only; skip time-locks unless time permits.)
- Single shared issuer account for all card assets vs. per-seller issuance? (Lean: single platform issuer for simplicity in the demo.)

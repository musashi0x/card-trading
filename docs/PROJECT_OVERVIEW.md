# StellarCards — Project Overview

A non-custodial trading card marketplace where every trade settles on Stellar. Cards are on-chain assets, and money moves through a single Soroban escrow contract — the backend never holds funds.

---

## 1. Problem Statement

Trading card collectors and merchants face the same three problems whether they trade physical cards or digital ones:

- **Trust gap on payment.** In peer-to-peer card trades, someone has to go first — ship the card before being paid, or pay before receiving the card. Existing marketplaces solve this by becoming a custodial middleman that holds both the money and the goods, taking high fees and creating counterparty and platform risk.
- **Opaque, slow, expensive settlement.** Card platforms and payment processors charge 10–20% in combined fees, settle in days, and give the seller no on-chain proof of ownership or transfer. Creators who originate cards capture nothing on the secondary market.
- **Payment friction kills consumer flows.** Crypto-native marketplaces typically require buyers to hold the exact settlement asset, fund a wallet with gas, sign confusing transactions, and manage seed phrases — friction that stops mainstream buyers before they ever complete a purchase.

**In short:** there is no card marketplace that combines *trustless, atomic settlement* with a *consumer-grade payment experience* and *fair economics for creators* — all without a custodial intermediary.

---

## 2. Proposed Solution

**StellarCards** makes the payment flow the product. Cards are issued as on-chain Stellar assets, and every trade — fixed-price sale, auction, barter swap, or physical-card escrow — settles atomically through a single Soroban settlement contract. The chain is the source of truth for ownership and money; the backend is a read-optimized mirror for search, metadata, and history and never custodies funds.

Core capabilities:

- **Atomic, non-custodial settlement.** The settlement contract locks the asset in escrow and releases card and payment together, or not at all. No party has to go first, and no middleman holds the funds.
- **Multiple trade primitives, one contract:**
  - **Fixed-price listings** — list, make/accept offers, buy now.
  - **Timed English auctions** — anti-snipe extension (bids near close push the deadline), reserve price, max 30-day duration, on-chain settlement to the winner.
  - **Card-for-card barter swaps** — both parties' cards locked and exchanged atomically, with an optional cash sweetener.
  - **Physical-card escrow orders** — funded → shipped → released lifecycle with a buyer confirmation window and arbiter-based dispute resolution.
- **Consumer-grade checkout (low friction):**
  - **Passkey smart wallets** — biometric "Pay with Face ID" via Soroban smart-wallet accounts; no seed phrase.
  - **Gasless transactions** — relayed through Launchtube so buyers never need to hold XLM for fees; wallets are deployed on first use.
  - **Pay with any asset** — buyers pay in XLM or any Stellar asset; a DEX path payment converts to the seller's settlement asset (USDC) on-chain, with bounded slippage.
- **Fair creator economics.** Royalties are enforced on-chain: every secondary sale splits funds between seller, platform, and the original creator automatically.
- **Social and discovery layer.** Owner-verified card reviews, public comment threads, user profiles with achievement badges, portfolio valuation, watchlists, and a trader leaderboard.

---

## 3. Target Users / Audience

- **Collectors & traders** — people who buy, sell, swap, and auction trading cards and want provable ownership and trustless settlement without trusting a custodial platform.
- **Mainstream / crypto-curious buyers** — consumers who want a card without learning crypto first; passkey login, gasless transactions, and "pay with any asset" let them check out as easily as a Web2 store.
- **Card creators / issuers** — artists and brands who originate cards and want to capture ongoing value through automatic, on-chain royalties on every resale.
- **Physical-card sellers & buyers** — traders of real-world cards who need escrow with a ship/confirm/dispute lifecycle so neither side carries the risk of going first.
- **Merchants** — sellers running storefronts who want fast, low-fee, atomic settlement and no chargeback or custody risk.

---

## 4. Expected Stellar Integration

Stellar and Soroban are foundational, not bolted on — the chain holds the assets and settles every trade.

- **Cards as classic Stellar assets (SAC).** Each card is issued as a classic Stellar asset wrapped as a Stellar Asset Contract, so ownership lives on-chain and the settlement contract can `transfer` cards atomically.
- **Single Soroban settlement contract (Rust).** One escrow/settlement contract handles the full lifecycle for all trade types — listings, offers, auctions, swaps, and physical-order escrow — locking assets and releasing card + payment atomically.
- **On-chain creator royalties.** Each listing carries the creator address and royalty rate; the contract enforces the three-way split (seller / platform / creator) on every secondary sale.
- **Passkey smart wallets (secp256r1 / WebAuthn).** Buyers can transact from Soroban smart-wallet accounts authenticated by device biometrics — no seed phrase, deploy-on-first-use.
- **Gasless transactions via Launchtube.** Transactions are relayed so buyers don't need XLM for fees, removing the biggest onboarding barrier for mainstream users.
- **Path payments via the Stellar DEX.** The API uses Horizon path-finding to build `PathPaymentStrictReceive` transactions, letting buyers pay in any asset while sellers receive exact USDC, converted on-chain.
- **Soroban RPC + Horizon indexer.** A backend indexer polls Stellar for contract events and reconciles them into PostgreSQL, keeping search and history in sync while the chain remains the source of truth.
- **Network.** Built and demonstrated on the **Stellar testnet** (Soroban RPC + Horizon), with scripts for testnet setup, demo listings, and end-to-end verification.

**Stellar features used:** Soroban smart contracts · Stellar Asset Contracts (SAC) · classic asset issuance · path payments / DEX · passkey smart wallets (secp256r1) · Launchtube gasless relay · Horizon API · Soroban RPC · Freighter / Stellar Wallets Kit.

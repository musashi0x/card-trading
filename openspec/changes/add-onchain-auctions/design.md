## Context

The deployed Soroban settlement contract (`packages/contracts/src/lib.rs`) is a fixed-price marketplace. It exposes `list`, `cancel_listing`, `make_offer`, `withdraw_offer`, `accept_offer`, `buy_now`, `purchase_escrow`, `mark_shipped`, `confirm_receipt`, `claim_timeout`, and `dispute`. All of these operate on `Listing` and `Offer` structs keyed by auto-incrementing `u32` ids.

The web UI (`apps/web/src/components/topdeck/`) is skinned as an auction house. `lib.ts` simulates `currentBid`, `endsAt` (deterministic hash of listing id → `simulatedEndsAt`), and a `bids[]` array. `TopDeckProvider.tsx` runs `confirmBid`, `openBid`, and `scheduleRival` (a `setTimeout`-based bot) entirely in JavaScript — no USDC is ever escrowed, no on-chain state changes. The `my-bids` page reflects local React state only.

The shared types (`packages/shared/src/types.ts`) define `TradeAction` as a union covering fixed-price actions only. The indexer (`apps/api/src/indexer.ts`) subscribes to `settle`, `list`, `offer`, `cancel`, `refund`, `funded`, `shipped`, `release` events.

Constraints: Testnet only; no production migration required. The contract is redeployed on changes. USDC is the only settlement currency. Passkey smart-wallet buyers participate in fixed-price trades; auction bids use the standard Stellar wallet path (passkey integration in auctions is a non-goal for this change).

## Goals / Non-Goals

**Goals:**
- Timed English auctions with USDC escrow for each bid; outbid refunds the previous bidder atomically.
- Anti-snipe: any bid landing within 5 minutes of `ends_at` extends `ends_at` by 5 minutes.
- Atomic settlement: `settle_auction` transfers card → winner and distributes funds (fee + creator royalty + seller net) in one Soroban invocation, reusing `release_from_custody`.
- Reserve price: if no bid meets or exceeds the reserve, the seller may cancel and reclaim the card.
- Cancel path: seller can cancel an auction with no bids; once bids exist, cancellation is blocked.
- Fixed-price listings and auction listings coexist in the same contract and in the same DB tables/API.
- New `auctions` and `bids` DB tables indexed by four new event types.
- Real bid UI: replace `confirmBid`/`scheduleRival` with a real `place_bid` flow; live countdown from DB `ends_at`; real bid history; real my-bids.
- Remove all simulated auction fields from `lib.ts` and `TopDeckProvider.tsx`.

**Non-Goals:**
- Dutch (descending-price) auctions.
- Reserve-price concealment (reserve is stored on-chain but need not be disclosed in the UI during the auction).
- Passkey/smart-wallet auction bids (phase 2 if needed).
- Automatic on-chain settlement trigger — settlement is caller-initiated (`settle_auction` is callable by anyone once `ends_at` has passed).
- NFT-style royalty enforcement at the token level.
- Bid increments enforced on-chain (minimum increment is a UI concern).

## Decisions

### Decision 1: Extend the existing settlement contract with new entrypoints rather than deploying a second contract

Auction storage and settlement logic live in the same `lib.rs` alongside `Listing`, `Offer`, and `Order`. New `DataKey` variants hold `Auction` structs and `Bid` structs.

- **Why:** A second contract would require its own deploy, init, and wasm management, and the auction settlement path needs to reuse `release_from_custody` (fee + royalty split) verbatim — duplication or cross-contract calls would be significantly more complex. The existing contract already holds cards in escrow for listings; the same escrow model applies to auctions. Single-contract also simplifies the indexer (one contract address to subscribe to) and the API (one contract client).
- **Alternative considered:** Separate auction contract that calls back into the settlement contract for `release_from_custody`. Rejected: cross-contract auth complexity on Soroban is high; the wasm size difference is negligible.

### Decision 2: One bid per bidder per auction in contract storage; previous bid amount replaced on outbid

The contract stores `DataKey::Bid(auction_id, bidder) -> i128`. When a bidder is outbid and bids again, their new amount replaces the old one. On outbid, the contract refunds the previous *highest bidder's* full amount and stores the new highest-bidder reference on the `Auction` struct (`high_bidder`, `high_bid`).

- **Why:** Storing one i128 per (auction, bidder) is the minimal state needed to compute refunds. Maintaining a full ordered bid log on-chain is prohibitively expensive in Soroban storage fees. The bid history (all bids by all bidders) is reconstructed from indexed `bid_placed` events in Postgres — the contract only needs to know who to refund at settlement.
- **Alternative considered:** Storing all bids as a `Vec<Bid>` on the Auction. Rejected: unbounded vector is a denial-of-service vector (gas/storage) and unnecessary — the indexer can replay events.
- **Alternative considered:** Auto-refund on every outbid with no bid storage. Accepted — this is exactly the chosen model: when bidder B outbids bidder A, A's funds are returned immediately in the same invocation. The `DataKey::Bid` stores the *current escrow amount* for each bidder (which should be zero once refunded, but is kept for claim-refund safety below).

### Decision 3: Auto-refund on outbid; claim_refund as safety fallback

When a higher bid is placed, the contract refunds the previous high bidder immediately (same invocation). A `claim_refund(auction_id)` entrypoint is also provided as a safety valve in case the auto-refund fails (e.g., the previous bidder's USDC trustline was removed after bidding). `claim_refund` reads `DataKey::Bid(auction_id, caller)` and pays out any remaining amount.

- **Why auto-refund first:** The user experience strongly prefers not requiring a separate claim transaction. On Soroban, the refund transfer is atomic with the bid acceptance, so there is no race condition.
- **Why keep claim_refund:** Defense in depth — if the previous bidder has done something to make the refund fail (trustline removal, account merge), the contract must not be stuck. `claim_refund` gives them a path out.

### Decision 4: Anti-snipe extends ends_at in contract storage

In `place_bid`, after validating the bid is higher, the contract checks `env.ledger().timestamp() > auction.ends_at - 300` (5 minutes = 300 seconds). If true, it sets `auction.ends_at += 300`. The new `ends_at` is emitted in the `bid_placed` event.

- **Why on-chain:** The deadline must be authoritative on-chain so any subsequent bid or settle call sees the extended deadline. A client-side extension would be trivially bypassed.
- **Alternative considered:** Fixed-length extension until no bids for N minutes. Rejected: requires a heartbeat mechanism that doesn't exist on Soroban (no timers).

### Decision 5: Auction and fixed-price listings are separate storage keys; both coexist

Auctions use `DataKey::Auction(auction_id: u32)` keyed by a separate counter `DataKey::AuctionCount`. The existing `DataKey::Listing`, `DataKey::ListingCount`, etc. are unchanged. A card may be in only one open listing OR one open auction at a time (enforced by the seller escrowing the card at creation — the card can only be in escrow once).

- **Why separate keys:** Sharing a listing id space between fixed-price and auction would require a discriminant on every lookup and would make the existing listing entrypoints brittle. Clean separation keeps the code auditable.

### Decision 6: `settle_auction` is permissionless after ends_at; reuses `release_from_custody`

Anyone can call `settle_auction(auction_id)` once `env.ledger().timestamp() >= auction.ends_at`. If `high_bidder` is set and `high_bid >= reserve`, settlement proceeds: `release_from_custody` is called with `buyer = high_bidder`, `amount = high_bid`. The card goes to the winner; funds split fee/royalty/seller as on a fixed-price sale. If no bids or reserve not met, the auction transitions to `AUCTION_NO_WINNER` and the card is returned to the seller.

- **Why permissionless:** Nobody has a private incentive to be the sole settler; allowing any caller means the platform or any third party can sweep expired auctions, preventing cards from being stuck. A seller-only settle would require an active seller; buyer-only would require the winner to know they won.
- **Why reuse `release_from_custody`:** The fee + royalty + seller-net logic is identical to `accept_offer`. DRY.

### Decision 7: DB — separate `auctions` and `bids` tables; `listings` is not extended for auctions

A new `auctions` table carries auction-specific columns (reserve, ends_at, status, high_bidder). A new `bids` table carries per-bid rows. The `listings` table is NOT modified for auctions — coexistence is achieved by the distinct storage key space on-chain, and the browse API returns both listing and auction results from separate queries merged in the response.

- **Why not extend `listings`:** The `listings` table has a `price_usdc` (fixed price) that is semantically wrong for auctions (which have `start_price` and `reserve_price`). Nullable columns everywhere would make queries messy. A clean `auctions` table is easier to reason about.
- **Alternative considered:** Single table with a `type` discriminant. Rejected: too many nullable columns, more complex indexes.

### Decision 8: Indexer captures four new event topics; `auctions` and `bids` rows mirror on-chain state

The indexer subscribes to `auction_created`, `bid_placed`, `outbid`, `auction_settled`, and `auction_cancelled` event topics on the same contract address. Each event upserts/inserts the corresponding row. `outbid` events set `bids.outbid_at` on the previous bid row. `auction_settled` sets `auctions.status = 'settled'` and inserts a `trades` row (reusing the existing trade record for settlement analytics).

## Risks / Trade-offs

**Bid griefing (shill bidding):** A seller could bid on their own auction to push the price up. Mitigation: add a `seller != bidder` check in `place_bid` (same pattern as `buy_now` `SelfTrade` check). Not a full solution (seller could use an accomplice address), but it removes the trivially obvious abuse.

**Refund gas DoS:** If auto-refund of the previous high bidder fails (e.g., their trustline was removed), `place_bid` would panic and block new bids. Mitigation: `claim_refund` safety valve (Decision 3) means the outbid bidder can always recover funds; the contract should use a try-pattern for the refund transfer and transition to `AUCTION_STUCK` if it fails, then let `claim_refund` drain. Implementation note: Soroban's `try_invoke_contract` / `auth_try` patterns apply.

**Auction settlement not triggered:** If nobody calls `settle_auction` after `ends_at`, the card is stuck in escrow. Mitigation: the platform runs a cron job (off-chain) to sweep expired auctions; the UI shows a "Settle" button to any user on an expired auction.

**Clock drift between indexer and chain:** The indexer's `ends_at` is derived from the `auction_created` event's `ends_at` field (a ledger timestamp). Minor clock drift between DB and chain is acceptable; the contract is the authoritative gate. The UI countdown should say "~" when within a few seconds of ending.

**Reserve price disclosure:** The reserve is stored on-chain in `DataKey::Auction`, readable by anyone. There is no privacy for the reserve price. Non-goal for this change.

**Large bid history:** An auction with thousands of bids generates thousands of `bid_placed` events. The indexer inserts a row per bid; the bids table may grow large. Mitigation: the bids API endpoint is paginated; the UI shows only the last N bids.

## Migration Plan

This is a testnet contract — no production state. Steps:

1. Rebuild wasm with the new entrypoints (`soroban contract build`).
2. Redeploy: `soroban contract deploy` (new contract id) or `soroban contract install` + `upgrade` if the contract has an upgrade path.
3. `init` as before (fee_bps, admin, platform, arbiter, usdc, max_royalty_bps) — no new init arguments for auctions; the auction counter initializes lazily.
4. Re-seed demo data: run existing setup scripts; optionally create a demo auction.
5. Run Drizzle migration for `auctions` and `bids` tables.
6. Deploy updated API and web.

Rollback: redeploy prior wasm; revert DB migration; revert API and web deploys.

## Open Questions

- **Minimum bid increment enforcement on-chain?** Currently left to the UI. If shill-bidding becomes a concern, a `min_increment_bps` field on the Auction struct could be added later.
- **Auction duration limits?** Currently unbounded. Should `create_auction` cap duration at e.g. 30 days? Recommend yes — add a `MAX_AUCTION_DURATION_SECS` constant.
- **Passkey/smart-wallet auction participation?** Deferred. The passkey relay path in `apps/api/src/routes/tx/passkey.ts` does not yet handle the `place_bid` invocation model (which requires both a USDC transfer auth and the auction invocation). Tracked as a follow-up.

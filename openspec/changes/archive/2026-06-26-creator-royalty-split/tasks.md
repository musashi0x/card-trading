## 1. Settlement contract — royalty registry & state

- [x] 1.1 Add a `RoyaltyConfig { creator: Address, bps: u32 }` type and a `DataKey::Royalty(Address)` (keyed by `card_token`) persistent storage entry
- [x] 1.2 Add `creator: Address` and `royalty_bps: u32` fields to the `Listing` struct
- [x] 1.3 Add a `MaxRoyaltyBps` instance key; extend `init` to accept `max_royalty_bps` and assert `fee_bps + max_royalty_bps < BPS_DENOM`
- [x] 1.4 Add admin-only `set_royalty(env, card_token, creator, royalty_bps)`: require admin auth, reject `royalty_bps > max_royalty_bps` (new `RoyaltyTooHigh` error), write the registry entry
- [x] 1.5 Add a `get_royalty_view(card_token) -> RoyaltyConfig` read endpoint (defaulting to `bps = 0`, creator = caller-irrelevant) for the API/indexer

## 2. Settlement contract — bind & distribute royalty

- [x] 2.1 In `list`, read the royalty registry for `card_token` (default `bps = 0`, `creator = seller`) and snapshot `creator`/`royalty_bps` onto the new `Listing`
- [x] 2.2 Add a `split_royalty(env, amount, bps)` helper parallel to `split_fee`
- [x] 2.3 In `accept_offer`, compute `royalty` (zero when `listing.seller == listing.creator`), set `seller_amount = amount - fee - royalty`, transfer royalty to `listing.creator` from custody when `> 0`, then transfer seller/fee/card
- [x] 2.4 In `buy_now`, apply the same royalty computation and pay the creator directly from the buyer when `> 0`
- [x] 2.5 Extend the `settle` event payload to `(buyer, seller, amount, fee, royalty, creator)` in both settlement paths

## 3. Contract tests

- [x] 3.1 Test: `set_royalty` rejects rates above the cap and rejects non-admin callers
- [x] 3.2 Test: secondary sale via `accept_offer` splits three ways (seller / platform / creator) with correct amounts
- [x] 3.3 Test: `buy_now` applies the same three-way split
- [x] 3.4 Test: primary sale (`seller == creator`) takes no royalty
- [x] 3.5 Test: card with no registry entry settles as a two-way split (royalty = 0)
- [x] 3.6 Run `cd packages/contracts && cargo test` — all existing + new tests pass

## 4. Shared types & tx builders

- [x] 4.1 Add `creator` / `royalty_bps` to the shared `Listing` type and zod schemas
- [x] 4.2 Add a `set_royalty` tx builder and extend the settle-event decoder for the widened tuple
- [x] 4.3 Update fixtures to include a creator + royalty for sample cards

## 5. Database

- [x] 5.1 Add `creator_account` + `royalty_bps` columns to the card schema; add `royalty_amount` to the trade/settlement table
- [x] 5.2 Generate and apply the Drizzle migration
- [x] 5.3 Update the seed to populate creator/royalty for demo cards

## 6. API — catalog, indexer, pre-flight

- [x] 6.1 Include `creator` + `royalty_bps` in catalog/listing responses
- [x] 6.2 Update the indexer to parse the widened `settle` event and persist `royalty_amount` on the trade row
- [x] 6.3 Include `platform fee`, `royalty amount`, and seller net in trade-history responses
- [x] 6.4 Add creator USDC-trustline pre-flight validation when building `accept_offer` / `buy_now` for cards with a non-zero royalty

## 7. Web — disclosure & breakdown

- [x] 7.1 Show the creator royalty rate on listings with a non-zero royalty
- [x] 7.2 Render the full settlement breakdown in trade history (price, platform fee, creator royalty, seller net); omit/zero the royalty line on primary sales

## 8. Scripts & end-to-end

- [x] 8.1 In testnet setup, create a creator account, establish its USDC trustline, and call `set_royalty` for demo cards
- [x] 8.2 Pass `max_royalty_bps` in the deploy/`init` step
- [x] 8.3 Extend the e2e script to assert the three-way split on `accept_offer` and `buy_now`, and a two-way split on a primary sale
- [x] 8.4 Run `pnpm --filter @cardmkt/scripts run e2e` against testnet — all assertions pass

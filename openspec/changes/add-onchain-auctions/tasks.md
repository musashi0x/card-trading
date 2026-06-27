## 1. Settlement contract — auction storage types

- [x] 1.1 Add `AuctionStatus` enum variants (`Open`, `Settled`, `Cancelled`, `NoWinner`) to `DataKey` and storage helpers in `lib.rs`
- [x] 1.2 Define `Auction` struct with fields: `seller`, `card_token`, `start_price`, `reserve_price`, `ends_at`, `high_bidder` (Option), `high_bid`, `status`, `creator`, `royalty_bps`
- [x] 1.3 Add `DataKey::Auction(u32)`, `DataKey::AuctionCount`, and `DataKey::Bid(u32, Address)` storage variants
- [x] 1.4 Implement `get_auction` / `put_auction` / `get_auction_count` / `next_auction_id` helpers parallel to the existing listing helpers
- [x] 1.5 Add `seller != bidder` guard constant and `MAX_AUCTION_DURATION_SECS` constant

## 2. Settlement contract — new entrypoints

- [x] 2.1 Implement `create_auction(env, seller, card_token, start_price, reserve_price, duration)`: auth seller, validate duration > 0 and <= MAX, escrow card, persist Auction, emit `auction_created` event
- [x] 2.2 Implement `place_bid(env, bidder, auction_id, amount)`: auth bidder, require auction open + not expired + amount > high_bid && >= start_price + seller != bidder; anti-snipe extension (extend ends_at by 300 if within 300s); refund previous high_bidder; transfer new bid to escrow; update auction; emit `bid_placed` and `outbid` events
- [x] 2.3 Implement `settle_auction(env, auction_id)`: require auction open + ends_at passed; if high_bid >= reserve, call `release_from_custody(env, listing_view_from_auction, high_bidder, high_bid)`; else return card to seller and refund high_bidder; mark status; emit `auction_settled` or `auction_cancelled`
- [x] 2.4 Implement `cancel_auction(env, seller, auction_id)`: auth seller, require no bids (high_bid == 0), return card, mark cancelled, emit `auction_cancelled`
- [x] 2.5 Implement `claim_refund(env, bidder, auction_id)`: read `DataKey::Bid(auction_id, bidder)`; guard that bidder != current high_bidder on an open auction; transfer amount and zero the storage key
- [x] 2.6 Extend `release_from_custody` to accept a `Listing`-compatible view (or extract the fee/royalty/seller logic into a shared helper `settle_funds`) so both `accept_offer` and `settle_auction` call the same path without duplicating the split arithmetic

## 3. Contract tests and snapshots

- [x] 3.1 Add `test_create_auction_success` — verify card escrowed, auction record created, `auction_created` event emitted
- [x] 3.2 Add `test_create_auction_no_card` — verify rejection when seller doesn't hold card
- [x] 3.3 Add `test_place_bid_first` — verify USDC transferred to contract, auction high_bid updated, event emitted
- [x] 3.4 Add `test_place_bid_outbid` — verify previous high bidder refunded, new bidder's funds escrowed, both events emitted
- [x] 3.5 Add `test_place_bid_below_high` — verify rejection
- [x] 3.6 Add `test_place_bid_self_trade` — verify seller cannot bid
- [x] 3.7 Add `test_antisnipe_extension` — bid within 300s of end extends ends_at by 300; bid outside 300s does not
- [x] 3.8 Add `test_settle_auction_winner` — verify card transferred to winner, funds split (fee + royalty + seller net), `auction_settled` event matches amounts
- [x] 3.9 Add `test_settle_auction_no_reserve` — verify card returned to seller, bid refunded, `auction_cancelled` event
- [x] 3.10 Add `test_settle_before_end` — verify rejection
- [x] 3.11 Add `test_cancel_auction_no_bids` — verify card returned, auction cancelled
- [x] 3.12 Add `test_cancel_auction_with_bids` — verify rejection
- [x] 3.13 Add `test_claim_refund` — verify stuck refund can be claimed after outbid
- [x] 3.14 Update contract test snapshots (`cargo test -- --test-output immediate` or snapshot update command)

## 4. Database — auctions and bids tables

- [x] 4.1 Add `auctionStatus` pgEnum (`open`, `settled`, `cancelled`, `no_winner`) to `packages/db/src/schema.ts`
- [x] 4.2 Add `auctions` table: `id` (uuid), `contractAuctionId` (integer), `cardId` (uuid FK cards), `seller` (text), `startPriceUsdc` (numeric), `reservePriceUsdc` (numeric), `endsAt` (timestamp with tz), `highBidder` (text nullable), `highBidUsdc` (numeric default 0), `status` (auctionStatus default open), `escrowTxHash` (text), `settleTxHash` (text nullable), `createdAt` (timestamp)
- [x] 4.3 Add `bids` table: `id` (uuid), `auctionId` (uuid FK auctions), `bidder` (text), `amountUsdc` (numeric), `contractBidRef` (text nullable), `escrowTxHash` (text), `refundTxHash` (text nullable), `outbidAt` (timestamp nullable), `createdAt` (timestamp)
- [x] 4.4 Export `AuctionRow`, `BidRow` types from schema
- [x] 4.5 Generate and apply the Drizzle migration (`drizzle-kit generate` + `drizzle-kit push` or equivalent)

## 5. Shared types and contract tx builders

- [x] 5.1 Add `'create_auction' | 'place_bid' | 'settle_auction' | 'cancel_auction' | 'claim_refund'` to the `TradeAction` union in `packages/shared/src/types.ts`
- [x] 5.2 Add `CreateAuctionBuildRequest`, `PlaceBidBuildRequest`, `SettleAuctionBuildRequest`, `CancelAuctionBuildRequest` request types
- [x] 5.3 Add `Auction` and `Bid` shared types matching the API response shape
- [x] 5.4 Add `AuctionListResponse`, `BidListResponse`, `MyBidsResponse` API response types
- [x] 5.5 Add `contract.ts` helper functions for `create_auction`, `place_bid`, `settle_auction`, `cancel_auction`, `claim_refund` invocation building (parallel to existing `list`, `make_offer`, etc. helpers)

## 6. API — indexer: auction event handling

- [x] 6.1 Subscribe to `auction_created` events in `apps/api/src/indexer.ts`: parse payload, insert into `auctions` table
- [x] 6.2 Subscribe to `bid_placed` events: insert into `bids` table; update `auctions.high_bid`, `auctions.high_bidder`, `auctions.ends_at`
- [x] 6.3 Subscribe to `outbid` events: set `bids.outbid_at` on the matching bid row for the previous bidder
- [x] 6.4 Subscribe to `auction_settled` events: set `auctions.status = 'settled'`, `auctions.settle_tx_hash`; insert a `trades` row with buyer=high_bidder, seller, price=high_bid, fee, royalty
- [x] 6.5 Subscribe to `auction_cancelled` events: set `auctions.status = 'cancelled'` or `'no_winner'` based on payload

## 7. API — tx build endpoints for auction actions

- [x] 7.1 Add `POST /tx/build/create-auction` handler in `apps/api/src/routes/tx/build.ts`: parse `CreateAuctionBuildRequest`, pre-flight seller holds card, build unsigned XDR via `contract.ts` helper, return `BuildTxResponse`
- [x] 7.2 Add `POST /tx/build/place-bid` handler: parse `PlaceBidBuildRequest`, pre-flight bidder USDC balance >= bid amount, build unsigned XDR, return `BuildTxResponse`
- [x] 7.3 Add `POST /tx/build/settle-auction` handler: build unsigned XDR for `settle_auction`, no balance pre-flight required
- [x] 7.4 Add `POST /tx/build/cancel-auction` handler: build unsigned XDR for `cancel_auction`

## 8. API — auction REST endpoints

- [x] 8.1 Create `apps/api/src/routes/auctions.ts` with router registered in main app
- [x] 8.2 Implement `GET /auctions/:auctionId` — return full auction record with card metadata joined
- [x] 8.3 Implement `GET /auctions/:auctionId/bids` — paginated bid list ordered by amount desc, include `outbid_at` for visual treatment
- [x] 8.4 Implement `GET /auctions/bids?bidder=<address>` — all bids for a user across all auctions, with auction status denormalized
- [x] 8.5 Include open auctions in the existing catalog response (merge into `GET /listings` or add `GET /auctions` to be fetched in parallel by the web client)

## 9. Web — real auction bid flow

- [x] 9.1 Remove `openBid`, `confirmBid`, `scheduleRival` functions and their `setTimeout` / `Math.random` logic from `apps/web/src/components/topdeck/TopDeckProvider.tsx`
- [x] 9.2 Add `placeBid(auctionId, amount)` action to TopDeckProvider: call `POST /tx/build/place-bid`, wallet sign, `POST /tx/submit`, refresh auction state
- [x] 9.3 Add `settleAuction(auctionId)` action: build + sign + submit `settle_auction` transaction
- [x] 9.4 Add `cancelAuction(auctionId)` action: build + sign + submit `cancel_auction` transaction
- [x] 9.5 Add `createAuction(params)` action: build + sign + submit `create_auction` transaction
- [x] 9.6 Wire the bid modal to `placeBid` (replaces the simulated confirm flow); validate amount > current high bid before enabling submit

## 10. Web — auction card UI updates

- [x] 10.1 Update `TopCard` type in `apps/web/src/components/topdeck/lib.ts`: replace `endsAt` simulated computation with real `endsAt` from the API auction record; remove `simulatedEndsAt` function
- [x] 10.2 Update `listingToTopCard` (or equivalent mapping function) to populate `endsAt`, `currentBid`, and `bids` from the real auction API response instead of mock values
- [x] 10.3 Remove the `mockCards` bids seed array from `lib.ts` (the bids array on TopCard is now sourced from the bids API)
- [x] 10.4 Update the card detail page (`apps/web/src/app/(marketplace)/card/[id]/page.tsx`) to fetch and render the real bid history from `GET /auctions/:id/bids`
- [x] 10.5 Add visual treatment for outbid bids in the history (e.g., muted/strikethrough styling)
- [x] 10.6 Show "Settle Auction" button on expired auctions (any user can trigger)

## 11. Web — my-bids page

- [x] 11.1 Replace the simulated my-bids data source in `apps/web/src/app/(marketplace)/my-bids/page.tsx` with a real fetch to `GET /auctions/bids?bidder=<connectedAddress>`
- [x] 11.2 Group bids by status: active (open auction, user is high bidder), outbid (open auction, user was outbid), won (settled, user is high_bidder), ended-lost (settled/cancelled, user is not winner)
- [x] 11.3 Show appropriate empty state when user has placed no bids

## 12. Web — sell flow: auction listing type

- [x] 12.1 Add "Auction" listing type option to the Sell form alongside "Fixed price"
- [x] 12.2 When "Auction" is selected, show start price, reserve price (optional), and duration (hours/days selector) fields; hide the fixed buy-now price field
- [x] 12.3 Validate: start price > 0, duration > 0; reserve price >= start_price if provided
- [x] 12.4 On confirmation, call `createAuction` action and redirect to the active auction card

## 13. End-to-end verification and mock removal

- [x] 13.1 Verify contract tests pass (`cargo test` in `packages/contracts`)
- [x] 13.2 Smoke-test the full auction flow on testnet: create → bid → outbid (verify refund) → anti-snipe → settle
- [x] 13.3 Verify my-bids page shows real bids for a test wallet
- [x] 13.4 Remove any remaining references to `simulatedEndsAt`, `scheduleRival`, `openBid`, and mock `bids[]` seeds from `lib.ts` and `TopDeckProvider.tsx` that were not removed in tasks 9–10
- [x] 13.5 Confirm no `TopCard.endsAt` value is computed from the old hash-based simulation; grep for `simulatedEndsAt` and assert zero hits

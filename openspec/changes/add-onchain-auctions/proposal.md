## Why

The marketplace UI is skinned as an auction house — countdown timers, current bids, bid history, rival bidders — but the settlement contract is fixed-price only. Every "auction" is a JavaScript simulation (`simulatedEndsAt`, `scheduleRival`, mock bids) with no on-chain state. Users who place bids are not actually committing funds, and there is no real winner. This change replaces that fiction with real timed English auctions settled on-chain to the highest bidder.

## What Changes

- **NEW** timed English auction listings: a seller creates an auction with a start price, optional reserve, and duration; the card is escrowed in the contract at creation time.
- **NEW** on-chain bid placement: each bid escrows the bid amount in USDC in the contract; the previous high bid is refunded atomically on each outbid event.
- **NEW** anti-snipe extension: if a bid lands within the final 5 minutes, the auction end time is extended by 5 minutes to prevent last-second sniping.
- **NEW** on-chain settlement: when the auction closes, `settle_auction` transfers the card to the winner and splits funds — platform fee + creator royalty + seller net — atomically; if the reserve is not met or no bids exist, the seller can cancel and reclaim the card.
- **BREAKING** `marketplace-settlement-contract`: the contract gains four new entrypoints (`create_auction`, `place_bid`, `settle_auction`, `cancel_auction`) and new auction/bid storage maps; fixed-price listings coexist with auction listings and both are supported.
- **MODIFIED** DB: new `auctions` and `bids` tables; the indexer captures `auction_created`, `bid_placed`, `outbid`, and `auction_settled` events into these tables.
- **MODIFIED** API: new build/submit endpoints for auction actions; new REST endpoints for bid history per auction; indexer handles four new event types.
- **MODIFIED** Web: the simulated bid flow (`confirmBid`, `scheduleRival`, `openBid`, `simulatedEndsAt`, mock bids in `lib.ts`) is removed and replaced by the real on-chain auction flow; countdowns derive from the real `ends_at` stored on the auction; my-bids page is fed by real bid rows.

## Capabilities

### New Capabilities
- `marketplace-auctions`: timed English auctions — create, bid, anti-snipe extension, settle to highest bidder (with fee/royalty split), cancel on reserve-not-met.

### Modified Capabilities
- `marketplace-settlement-contract`: contract gains auction entrypoints, auction/bid storage, and a new settlement path; fixed-price and auction modes coexist.
- `marketplace-api`: indexer subscribes to four new auction event types; new REST endpoints for auction bids and auction state; tx-build endpoints for the four new auction actions.
- `marketplace-web`: real bid flow replaces the fully simulated auction UI; live countdown, real bid history, real my-bids; remove all simulated auction fields.

## Impact

- **Contract** (`packages/contracts/src/lib.rs`): new `Auction` and `Bid` storage types; new entrypoints `create_auction`, `place_bid`, `settle_auction`, `cancel_auction`; reuse `release_from_custody` (fee + royalty split) at settlement; new events `auction_created`, `bid_placed`, `outbid`, `auction_settled`, `auction_cancelled`. New unit tests in `src/test.rs`.
- **Shared** (`packages/shared`): new `TradeAction` variants for auction actions; new request/response types for auction build calls; new `Auction` and `Bid` shared types.
- **DB** (`packages/db`): new `auctions` table (contract_auction_id, card_id, seller, start_price, reserve_price, ends_at, status, escrow_tx_hash, settle_tx_hash) and `bids` table (auction_id, bidder, amount_usdc, contract_bid_ref, escrow_tx_hash, refund_tx_hash, outbid_at); Drizzle migration required.
- **API** (`apps/api`): indexer parses four new event types; `routes/tx/build.ts` gains four new auction build handlers; new `routes/auctions.ts` serves bid history and auction state.
- **Web** (`apps/web`): `lib.ts` loses `simulatedEndsAt`, `bids[]` mock seeds, `TopCard.endsAt` simulation; `TopDeckProvider.tsx` loses `openBid`, `confirmBid`, `scheduleRival` and gains real `placeBid` / `settleAuction`; `my-bids/page.tsx` queries the real bids API; card detail bid history renders live.

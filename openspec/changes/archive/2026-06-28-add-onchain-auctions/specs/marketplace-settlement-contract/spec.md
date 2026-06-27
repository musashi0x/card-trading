## ADDED Requirements

### Requirement: Create an auction listing in the contract
The settlement contract SHALL expose a `create_auction` entrypoint that escrows a card and records an `Auction` struct (seller, card_token, start_price, reserve_price, ends_at, high_bidder, high_bid, status). The auction id SHALL be assigned from a separate auto-incrementing counter distinct from the listing counter.

#### Scenario: Auction created and card escrowed
- **WHEN** a seller calls `create_auction` with a valid card, start price, reserve price, and duration
- **THEN** the contract SHALL transfer the card into its own custody
- **AND** SHALL record an open auction with `ends_at = ledger.timestamp() + duration`
- **AND** SHALL emit `(Symbol::new("auction_created"), auction_id)` with payload `(seller, card_token, start_price, reserve_price, ends_at)`

#### Scenario: Seller does not hold the card
- **WHEN** a seller calls `create_auction` for a card they do not hold
- **THEN** the contract SHALL reject the transaction

#### Scenario: Zero duration is rejected
- **WHEN** a seller calls `create_auction` with duration of zero
- **THEN** the contract SHALL reject the transaction

#### Scenario: Auction and fixed-price listing coexist for different cards
- **WHEN** a seller has an open fixed-price listing for card A and calls `create_auction` for card B
- **THEN** the contract SHALL create both records independently using separate id counters

### Requirement: Place a bid with on-chain escrow
The settlement contract SHALL expose a `place_bid` entrypoint that transfers the bid amount from the bidder to contract custody. The bid MUST exceed the current `high_bid` and MUST meet or exceed `start_price`. The previous high bidder's escrowed amount SHALL be refunded atomically. A `DataKey::Bid(auction_id, bidder)` SHALL record the remaining escrowed amount per bidder for `claim_refund` safety.

#### Scenario: First bid escrowed
- **WHEN** a bidder calls `place_bid` with an amount >= `start_price` on an open auction with no bids
- **THEN** the contract SHALL transfer the amount from the bidder
- **AND** SHALL update `auction.high_bidder` and `auction.high_bid`
- **AND** SHALL emit `bid_placed` with `(auction_id, bidder, amount, ends_at)`

#### Scenario: Outbid refunds previous bidder
- **WHEN** a bidder calls `place_bid` with an amount exceeding the current `high_bid`
- **THEN** the contract SHALL refund the previous `high_bidder` their escrowed amount
- **AND** SHALL update `high_bidder` and `high_bid` to the new values
- **AND** SHALL emit `bid_placed` and `outbid(auction_id, prev_bidder, refund_amount)`

#### Scenario: Bid at or below the current high bid is rejected
- **WHEN** a bidder calls `place_bid` with an amount <= `auction.high_bid`
- **THEN** the contract SHALL reject the transaction

#### Scenario: Bid after ends_at is rejected
- **WHEN** a bidder calls `place_bid` after `ledger.timestamp() >= auction.ends_at`
- **THEN** the contract SHALL reject the transaction

### Requirement: Anti-snipe: extend ends_at on late bid
The contract SHALL extend `auction.ends_at` by 300 seconds whenever a successful bid is placed within 300 seconds of the current `ends_at`. The extension SHALL be persisted and included in the `bid_placed` event.

#### Scenario: Late bid extends the deadline
- **WHEN** a valid bid is placed and `ledger.timestamp() > auction.ends_at - 300`
- **THEN** the contract SHALL set `auction.ends_at += 300` before emitting the event

#### Scenario: Early bid does not change the deadline
- **WHEN** a valid bid is placed and `ledger.timestamp() <= auction.ends_at - 300`
- **THEN** the contract SHALL leave `auction.ends_at` unchanged

#### Scenario: Extended ends_at is propagated to the bid_placed event
- **WHEN** an anti-snipe extension occurs
- **THEN** the `bid_placed` event SHALL carry the new `ends_at` value so the indexer updates the DB

#### Scenario: Extension does not create a new auction record
- **WHEN** the extension occurs
- **THEN** `DataKey::Auction(auction_id).ends_at` SHALL be updated in-place; no new id is allocated

### Requirement: Settle auction to the highest bidder (permissionless after ends_at)
The settlement contract SHALL expose a `settle_auction(auction_id)` entrypoint callable by anyone once `ledger.timestamp() >= auction.ends_at`. If the `high_bid >= reserve_price`, the contract SHALL call `release_from_custody` (fee + royalty + seller net) using `high_bidder` as buyer and `high_bid` as amount. If reserve is not met or no bids exist, the card is returned to the seller.

#### Scenario: Settlement to winner with fee and royalty split
- **WHEN** `settle_auction` is called on an expired auction where `high_bid >= reserve_price`
- **THEN** the contract SHALL transfer the card to `high_bidder` and distribute funds via `release_from_custody` (platform fee, creator royalty if applicable, seller net)
- **AND** SHALL mark the auction `settled` and emit `auction_settled(auction_id, buyer, seller, amount, fee, royalty)`

#### Scenario: Reserve not met — card returned, bids refunded
- **WHEN** `settle_auction` is called on an expired auction where `high_bid < reserve_price`
- **THEN** the contract SHALL return the card to the seller
- **AND** SHALL refund `high_bid` to `high_bidder` (if any)
- **AND** SHALL mark the auction `no_winner` and emit `auction_cancelled`

#### Scenario: settle_auction before ends_at is rejected
- **WHEN** `settle_auction` is called before `ledger.timestamp() >= auction.ends_at`
- **THEN** the contract SHALL reject the transaction

#### Scenario: Double settlement is rejected
- **WHEN** `settle_auction` is called on an already-settled or cancelled auction
- **THEN** the contract SHALL reject the transaction

### Requirement: Cancel auction (no bids)
The settlement contract SHALL expose a `cancel_auction(auction_id)` entrypoint. A seller MAY cancel an open auction that has received no bids (`high_bid == 0`). Cancellation with bids SHALL be rejected.

#### Scenario: Seller cancels a no-bid auction
- **WHEN** the seller calls `cancel_auction` on an open auction with `high_bid == 0`
- **THEN** the contract SHALL return the card to the seller
- **AND** SHALL mark the auction `cancelled` and emit `auction_cancelled(auction_id, seller)`

#### Scenario: Cancellation rejected when bids exist
- **WHEN** the seller calls `cancel_auction` on an auction with at least one bid
- **THEN** the contract SHALL reject the transaction

#### Scenario: Non-seller cannot cancel
- **WHEN** a non-seller calls `cancel_auction`
- **THEN** the contract SHALL reject the transaction

#### Scenario: Cannot cancel a settled auction
- **WHEN** `cancel_auction` is called on an already-settled or already-cancelled auction
- **THEN** the contract SHALL reject the transaction

### Requirement: Claim refund safety valve
The settlement contract SHALL expose a `claim_refund(auction_id)` entrypoint. A bidder who has escrowed funds for an auction (stored in `DataKey::Bid(auction_id, bidder)`) MAY call it to withdraw any amount still owed to them that was not returned by the auto-refund path.

#### Scenario: Bidder claims a stuck refund
- **WHEN** a bidder calls `claim_refund` and `DataKey::Bid(auction_id, bidder)` holds a positive amount
- **THEN** the contract SHALL transfer that amount to the caller
- **AND** SHALL zero out the stored bid amount

#### Scenario: Claim with no outstanding balance is a no-op
- **WHEN** a bidder calls `claim_refund` and holds no escrowed balance
- **THEN** the contract SHALL return without error and without transferring any funds

#### Scenario: Current high bidder cannot claim before settlement
- **WHEN** the current `high_bidder` calls `claim_refund` before `ends_at`
- **THEN** the contract SHALL reject the transaction

#### Scenario: Claim succeeds after no-winner cancellation
- **WHEN** an auction is in `no_winner` state and the former high bidder calls `claim_refund`
- **THEN** the contract SHALL return the full bid amount to them

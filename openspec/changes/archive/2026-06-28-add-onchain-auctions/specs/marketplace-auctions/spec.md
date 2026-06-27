## ADDED Requirements

### Requirement: Create an auction listing
A seller SHALL be able to create a timed English auction by specifying a card, a start price, an optional reserve price, and a duration in seconds. The contract SHALL escrow the card from the seller and record the auction with a computed `ends_at` timestamp. The auction SHALL be assigned a unique `auction_id`.

#### Scenario: Seller creates an auction
- **WHEN** a seller invokes `create_auction` with a valid card token, start price, reserve price, and duration
- **THEN** the contract SHALL transfer the card into escrow
- **AND** SHALL record an auction with `status = open`, `ends_at = now + duration`, and `high_bid = 0`
- **AND** SHALL emit an `auction_created` event with `(auction_id, seller, card_token, start_price, reserve_price, ends_at)`

#### Scenario: Seller without the card cannot create an auction
- **WHEN** a seller invokes `create_auction` for a card they do not hold
- **THEN** the contract SHALL reject the transaction

#### Scenario: Duplicate auction on same card is blocked
- **WHEN** a seller invokes `create_auction` for a card that is already escrowed in an open auction or listing
- **THEN** the contract SHALL reject the transaction because the card is already in escrow

#### Scenario: Zero-duration auction is rejected
- **WHEN** a seller invokes `create_auction` with a duration of zero seconds
- **THEN** the contract SHALL reject the transaction with an invalid duration error

### Requirement: Place a bid with USDC escrow
A bidder SHALL be able to place a bid on an open auction by transferring the bid amount in USDC to the contract. The bid MUST exceed the current high bid and MUST meet or exceed the start price. When a new high bid is placed, the previous high bidder's escrowed funds SHALL be refunded atomically in the same invocation.

#### Scenario: First bid on an auction
- **WHEN** a bidder places a bid at or above the start price on an open auction with no existing bids
- **THEN** the contract SHALL transfer the bid amount from the bidder to escrow
- **AND** SHALL record `high_bidder` and `high_bid` on the auction
- **AND** SHALL emit a `bid_placed` event with `(auction_id, bidder, amount, ends_at)`

#### Scenario: Outbid refunds the previous high bidder
- **WHEN** a second bidder places a bid that exceeds the current high bid
- **THEN** the contract SHALL transfer the new bid amount from the new bidder to escrow
- **AND** SHALL refund the previous high bidder's full escrowed amount atomically
- **AND** SHALL emit `bid_placed` and `outbid` events

#### Scenario: Bid below the current high bid is rejected
- **WHEN** a bidder places a bid that does not exceed the current high bid
- **THEN** the contract SHALL reject the transaction

#### Scenario: Seller cannot bid on their own auction
- **WHEN** the auction seller attempts to place a bid on their own auction
- **THEN** the contract SHALL reject the transaction

### Requirement: Anti-snipe time extension
The contract SHALL automatically extend the auction's `ends_at` by 5 minutes (300 seconds) when a bid is placed within 5 minutes of the current `ends_at`. The extended `ends_at` SHALL be persisted on-chain and emitted in the `bid_placed` event.

#### Scenario: Late bid extends the auction
- **WHEN** a valid bid is placed when fewer than 300 seconds remain before `ends_at`
- **THEN** the contract SHALL add 300 seconds to `ends_at` and persist the new value
- **AND** the `bid_placed` event SHALL carry the updated `ends_at`

#### Scenario: Early bid does not extend the auction
- **WHEN** a valid bid is placed when more than 300 seconds remain before `ends_at`
- **THEN** the contract SHALL NOT modify `ends_at`

#### Scenario: Multiple late bids each extend the auction
- **WHEN** two bids are placed in succession within the final 5 minutes
- **THEN** each bid SHALL add 300 seconds to the `ends_at` at the time of that bid

#### Scenario: Bid on an expired auction is rejected
- **WHEN** a bid is placed after the auction's `ends_at` has passed
- **THEN** the contract SHALL reject the transaction

### Requirement: Settle an auction to the highest bidder
Any caller SHALL be able to invoke `settle_auction` on an auction whose `ends_at` has passed. If the highest bid meets or exceeds the reserve price, the contract SHALL transfer the card to the winner and atomically split the bid amount into platform fee, creator royalty, and seller net. If the reserve is not met or no bids exist, the auction SHALL transition to a no-winner state and the card SHALL be returned to the seller.

#### Scenario: Auction settles to the highest bidder
- **WHEN** `settle_auction` is called on an expired auction where `high_bid >= reserve_price`
- **THEN** the contract SHALL transfer the card to `high_bidder`
- **AND** SHALL distribute `high_bid` as: platform fee, creator royalty (if applicable), seller net
- **AND** SHALL mark the auction `settled` and emit an `auction_settled` event with the full split amounts

#### Scenario: Reserve not met returns card to seller
- **WHEN** `settle_auction` is called on an expired auction where `high_bid < reserve_price` (or no bids)
- **THEN** the contract SHALL return the escrowed card to the seller
- **AND** SHALL refund the highest bidder's escrowed amount (if any)
- **AND** SHALL mark the auction `no_winner` and emit `auction_cancelled`

#### Scenario: Settlement before auction ends is rejected
- **WHEN** `settle_auction` is called before the auction's `ends_at`
- **THEN** the contract SHALL reject the transaction

#### Scenario: Settlement is all-or-nothing
- **WHEN** any transfer in `settle_auction` fails (insufficient trustline, auth error)
- **THEN** the entire invocation SHALL revert and no state SHALL change

### Requirement: Cancel an auction with no bids
A seller SHALL be able to cancel an open auction and reclaim their escrowed card, provided no bids have been placed.

#### Scenario: Seller cancels an auction with no bids
- **WHEN** the seller calls `cancel_auction` on an open auction with `high_bid = 0`
- **THEN** the contract SHALL return the escrowed card to the seller
- **AND** SHALL mark the auction `cancelled` and emit `auction_cancelled`

#### Scenario: Auction with bids cannot be cancelled by the seller
- **WHEN** the seller calls `cancel_auction` on an open auction with at least one bid
- **THEN** the contract SHALL reject the transaction

#### Scenario: Non-seller cannot cancel an auction
- **WHEN** a non-seller calls `cancel_auction`
- **THEN** the contract SHALL reject the transaction

#### Scenario: Expired unsettled auction can be cancelled by anyone if reserve not met
- **WHEN** `cancel_auction` (or `settle_auction`) is called on an expired auction with no bids meeting the reserve
- **THEN** the contract SHALL return the card to the seller and transition to `no_winner`

### Requirement: Claim refund safety valve
A bidder who has been outbid or whose auto-refund failed SHALL be able to call `claim_refund(auction_id)` to withdraw any escrowed amount recorded against their address for that auction.

#### Scenario: Outbid bidder claims a stuck refund
- **WHEN** a bidder's auto-refund failed (e.g., trustline removed between bid and outbid) and they call `claim_refund`
- **THEN** the contract SHALL transfer their escrowed balance to them
- **AND** SHALL zero out their stored bid amount

#### Scenario: Claim refund with no outstanding balance is a no-op
- **WHEN** a bidder calls `claim_refund` and has no escrowed balance for that auction
- **THEN** the contract SHALL return without error and without transferring any funds

#### Scenario: Claim refund cannot be used by the winning bidder before settlement
- **WHEN** the current high bidder calls `claim_refund` before the auction is settled
- **THEN** the contract SHALL reject the transaction (their funds are committed to winning)

#### Scenario: Claim refund succeeds after reserve-not-met cancellation
- **WHEN** an auction is cancelled with the reserve not met and the highest bidder calls `claim_refund`
- **THEN** the contract SHALL return the full bid amount to the bidder

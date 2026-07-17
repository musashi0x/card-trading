## Purpose

A single non-custodial Soroban escrow primitive that locks cards and USDC and settles trades atomically, distributing a platform fee and a contract-enforced creator royalty.
## Requirements
### Requirement: List a card into escrow

The settlement contract SHALL accept a listing for a specific card copy
(`token_id`) and take custody of that token via the collection's standard
non-fungible transfer.

#### Scenario: Seller lists a card copy

- **WHEN** a seller calls `list` with a `token_id` and a USDC price
- **THEN** the contract SHALL transfer that token from the seller into its own
  custody via the collection contract
- **AND** SHALL record an open listing referencing the seller, token id, and
  price

#### Scenario: Listing requires the seller to own the copy

- **WHEN** an account calls `list` for a token it does not own
- **THEN** the collection transfer SHALL fail and no listing SHALL be created

### Requirement: Cancel a listing and reclaim the card
The settlement contract SHALL allow the seller of an open listing to cancel it and reclaim the escrowed card.

#### Scenario: Seller cancels an open listing
- **WHEN** the seller calls `cancel_listing` for their open listing
- **THEN** the contract SHALL return the escrowed card to the seller
- **AND** SHALL mark the listing as cancelled

#### Scenario: Only the seller can cancel
- **WHEN** a non-seller calls `cancel_listing` for a listing
- **THEN** the contract SHALL reject the transaction

### Requirement: Make an offer with escrowed funds
The settlement contract SHALL allow a buyer to make an offer on a listing by locking USDC in contract custody, producing a referenceable offer.

#### Scenario: Buyer makes an offer
- **WHEN** a buyer calls `make_offer` on an open listing with a USDC amount
- **THEN** the contract SHALL transfer that USDC into its own custody
- **AND** SHALL record an open offer referencing the buyer, listing, and amount

### Requirement: Withdraw an offer and reclaim funds
The settlement contract SHALL allow a buyer to withdraw their open offer and reclaim the escrowed USDC at any time before the offer is accepted.

#### Scenario: Buyer withdraws an unaccepted offer
- **WHEN** the buyer calls `withdraw_offer` for their open offer
- **THEN** the contract SHALL return the full escrowed USDC to the buyer
- **AND** SHALL mark the offer as withdrawn

#### Scenario: Accepted offers cannot be withdrawn
- **WHEN** a buyer calls `withdraw_offer` for an offer that has already been accepted
- **THEN** the contract SHALL reject the transaction

### Requirement: Atomic settlement with platform fee
The settlement contract SHALL settle a trade atomically in a single transaction, transferring the card to the buyer, a platform fee to the platform account, a creator royalty to the card's creator on secondary sales, and the remaining USDC to the seller.

#### Scenario: Seller accepts an offer
- **WHEN** the seller calls `accept_offer` for an open offer on their listing
- **THEN** the contract SHALL, in one atomic transaction, transfer the escrowed card to the buyer
- **AND** transfer the platform fee to the platform account
- **AND** transfer the creator royalty to the listing's creator
- **AND** transfer the remaining USDC (amount minus fee minus royalty) to the seller
- **AND** mark the listing as sold and the offer as settled

#### Scenario: Royalty is skipped on a primary sale
- **WHEN** a trade settles for a listing whose seller is the card's creator
- **THEN** the contract SHALL take no royalty
- **AND** the seller SHALL receive the amount minus only the platform fee

#### Scenario: Seller proceeds are never negative
- **WHEN** a trade settles
- **THEN** the sum of the platform fee and creator royalty SHALL NOT exceed the sale amount
- **AND** the seller's share SHALL be greater than or equal to zero

#### Scenario: Settlement is all-or-nothing
- **WHEN** any leg of `accept_offer` settlement cannot complete
- **THEN** the entire transaction SHALL revert
- **AND** the card and USDC SHALL remain in their pre-settlement custody

### Requirement: Buy-now as an auto-accepted offer
The settlement contract SHALL support buy-now as an offer at the listing's asking price that settles immediately, reusing the same settlement path as `accept_offer`, including the creator royalty distribution.

#### Scenario: Buyer buys at asking price
- **WHEN** a buyer calls `buy_now` on an open listing with USDC equal to the asking price
- **THEN** the contract SHALL settle the trade atomically using the same card / fee / royalty / seller distribution as an accepted offer
- **AND** mark the listing as sold

### Requirement: Configurable platform fee at initialization
The settlement contract SHALL apply a platform fee and bound creator royalties using rates defined at contract initialization, applied to every settlement.

#### Scenario: Fee applied on settlement
- **WHEN** a trade settles for a given USDC amount
- **THEN** the platform fee SHALL be computed from the initialized fee rate
- **AND** the seller SHALL receive the amount minus that fee and any applicable royalty

#### Scenario: Royalty cap set at initialization
- **WHEN** the contract is initialized
- **THEN** it SHALL record a maximum royalty rate
- **AND** that maximum plus the platform fee rate SHALL be less than the full sale amount in basis points

### Requirement: Create an auction listing in the contract

Auctions SHALL reference a specific card copy (`token_id`), escrowed via the
collection's standard non-fungible transfer.

#### Scenario: Auction created and card copy escrowed

- **WHEN** a seller calls `create_auction` with a valid `token_id`, start
  price, reserve price, and duration
- **THEN** the contract SHALL transfer that token into its own custody
- **AND** SHALL record an open auction with
  `ends_at = ledger.timestamp() + duration`
- **AND** SHALL emit `(Symbol::new("auction_created"), auction_id)` with a
  payload carrying `token_id` in place of the former `card_token`

#### Scenario: Zero duration is rejected

- **WHEN** a seller calls `create_auction` with duration of zero
- **THEN** the contract SHALL reject the transaction

#### Scenario: Auction and fixed-price listing coexist for different copies

- **WHEN** a seller has an open fixed-price listing for one copy and calls
  `create_auction` for another
- **THEN** the contract SHALL create both records independently using separate
  id counters

### Requirement: Listing binds the card's royalty at list time

The settlement contract SHALL read the token's creator and royalty rate from
the collection contract when a listing or auction is created and store that
snapshot on it, so settlement reads immutable economics that later royalty
changes cannot alter.

#### Scenario: Listing snapshots the royalty

- **WHEN** a seller lists a card copy whose token has a registered royalty
- **THEN** the contract SHALL store the creator and royalty rate on the open
  listing
- **AND** later royalty changes on the collection SHALL NOT affect the
  already-open listing

#### Scenario: Token without a royalty

- **WHEN** a card copy with a zero royalty rate is listed
- **THEN** the contract SHALL treat its creator as the seller and settle as a
  two-way split

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

### Requirement: Atomic card-for-card barter swap

The settlement contract SHALL provide a two-phase swap mechanism: `propose_swap`
locks the proposer's card tokens into custody; `execute_swap` simultaneously
pulls the counterparty's cards and releases all assets cross-directionally in a
single atomic transaction. Both `cancel_swap` and `decline_swap` return all
locked assets to their original owners.

#### Scenario: Proposer locks cards in custody
- **GIVEN** Alice holds card tokens [A1, A2]
- **WHEN** Alice calls `propose_swap(counterparty=Bob, give=[A1,A2], get=[B1], usdc=50)`
- **THEN** A1 and A2 SHALL be transferred to contract custody
- **AND** a `SwapProposal` SHALL be stored with `status = proposed`
- **AND** a `swap_proposed` event SHALL be emitted with the proposal id

#### Scenario: Counterparty executes and all assets move atomically
- **GIVEN** a `SwapProposal` with `status = proposed`, give=[A1,A2], get=[B1], usdc=50
- **WHEN** Bob calls `execute_swap(proposal_id)`
- **THEN** B1 SHALL be pulled from Bob's account
- **AND** A1 and A2 SHALL be released from custody to Bob
- **AND** B1 SHALL be transferred from custody to Alice
- **AND** 50 USDC shall be pulled from Alice and split: `fee = 50 * fee_bps / 10_000` to platform, remainder to Bob
- **AND** a `swap` event SHALL be emitted
- **AND** if any transfer fails the entire transaction SHALL revert

#### Scenario: Proposer cancels and cards are returned
- **GIVEN** a `SwapProposal` with `status = proposed`
- **WHEN** Alice calls `cancel_swap(proposal_id)` before Bob executes
- **THEN** A1 and A2 SHALL be returned from custody to Alice
- **AND** the proposal status SHALL be `cancelled`

#### Scenario: Counterparty declines and cards are returned
- **GIVEN** a `SwapProposal` with `status = proposed`
- **WHEN** Bob calls `decline_swap(proposal_id)`
- **THEN** A1 and A2 SHALL be returned from custody to Alice
- **AND** the proposal status SHALL be `declined`


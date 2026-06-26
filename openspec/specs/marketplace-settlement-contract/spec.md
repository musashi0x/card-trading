## Purpose

A single non-custodial Soroban escrow primitive that locks cards and USDC and settles trades atomically, distributing a platform fee and a contract-enforced creator royalty.
## Requirements
### Requirement: List a card into escrow
The settlement contract SHALL allow a seller to list a card by locking the card asset in contract custody at a stated USDC price, producing a referenceable listing.

#### Scenario: Seller lists a card
- **WHEN** a seller calls `list` with a card asset and a USDC price
- **THEN** the contract SHALL transfer the card into its own custody
- **AND** SHALL record an open listing referencing the seller, card, and price

#### Scenario: Listing requires the seller to own the card
- **WHEN** a seller calls `list` for a card they do not hold
- **THEN** the contract SHALL reject the transaction
- **AND** no listing SHALL be created

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

### Requirement: Register a creator royalty per card
The settlement contract SHALL maintain a per-card royalty registry that binds a card asset to a creator payout account and an immutable royalty rate in basis points, settable only by the contract admin and bounded by an initialization cap.

#### Scenario: Admin registers a royalty for a card
- **WHEN** the admin calls `set_royalty` with a card asset, a creator account, and a royalty rate at or below the configured cap
- **THEN** the contract SHALL record the creator and royalty rate for that card
- **AND** subsequent listings of that card SHALL bind that creator and rate

#### Scenario: Royalty rate above the cap is rejected
- **WHEN** the admin calls `set_royalty` with a royalty rate greater than the initialized maximum
- **THEN** the contract SHALL reject the transaction
- **AND** no royalty SHALL be recorded for that card

#### Scenario: Only the admin can register a royalty
- **WHEN** a non-admin account calls `set_royalty`
- **THEN** the contract SHALL reject the transaction

#### Scenario: Card without a registered royalty
- **WHEN** a card with no registry entry is listed
- **THEN** the contract SHALL treat its royalty rate as zero and its creator as the seller
- **AND** the listing SHALL still be created and settle as a two-way split

### Requirement: Listing binds the card's royalty at list time
The settlement contract SHALL copy the registered creator and royalty rate onto a listing when it is created, so settlement reads an immutable snapshot that later registry changes cannot alter.

#### Scenario: Listing snapshots the royalty
- **WHEN** a seller lists a card that has a registered royalty
- **THEN** the contract SHALL store the creator and royalty rate on the open listing
- **AND** a later `set_royalty` change for that card SHALL NOT affect the already-open listing


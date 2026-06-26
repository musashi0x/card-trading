## ADDED Requirements

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
The settlement contract SHALL settle a trade atomically in a single transaction, transferring the card to the buyer, the USDC to the seller minus a platform fee, and the fee to the platform account.

#### Scenario: Seller accepts an offer
- **WHEN** the seller calls `accept_offer` for an open offer on their listing
- **THEN** the contract SHALL, in one atomic transaction, transfer the escrowed card to the buyer
- **AND** transfer the escrowed USDC minus the platform fee to the seller
- **AND** transfer the platform fee to the platform account
- **AND** mark the listing as sold and the offer as settled

#### Scenario: Settlement is all-or-nothing
- **WHEN** any leg of `accept_offer` settlement cannot complete
- **THEN** the entire transaction SHALL revert
- **AND** the card and USDC SHALL remain in their pre-settlement custody

### Requirement: Buy-now as an auto-accepted offer
The settlement contract SHALL support buy-now as an offer at the listing's asking price that settles immediately, reusing the same settlement path as `accept_offer`.

#### Scenario: Buyer buys at asking price
- **WHEN** a buyer calls `buy_now` on an open listing with USDC equal to the asking price
- **THEN** the contract SHALL settle the trade atomically using the same card/USDC/fee distribution as an accepted offer
- **AND** mark the listing as sold

### Requirement: Configurable platform fee at initialization
The settlement contract SHALL apply a platform fee defined at contract initialization, applied to every settlement.

#### Scenario: Fee applied on settlement
- **WHEN** a trade settles for a given USDC amount
- **THEN** the platform fee SHALL be computed from the initialized fee rate
- **AND** the seller SHALL receive the amount minus that fee

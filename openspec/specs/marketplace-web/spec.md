## Purpose

Let users connect a Stellar wallet, browse and search cards, list cards for sale, make and withdraw offers, buy or accept atomically, and inspect settled trades.
## Requirements
### Requirement: Wallet connection
The web app SHALL let a user connect a Stellar wallet (Freighter) and display their connected address.

#### Scenario: User connects a wallet
- **WHEN** a user clicks connect and approves in the wallet
- **THEN** the app SHALL display the connected Stellar address
- **AND** subsequent trade actions SHALL be signed through that wallet

#### Scenario: Wallet not installed
- **WHEN** a user attempts to connect without the wallet available
- **THEN** the app SHALL show guidance on installing the wallet

### Requirement: Browse and search cards
The web app SHALL let users browse open listings and search cards by name, set, or rarity.

#### Scenario: Browse the marketplace
- **WHEN** a user opens the marketplace
- **THEN** the app SHALL display open listings with card image, name, rarity, and price in test USDC

#### Scenario: Search for a card
- **WHEN** a user enters a search term
- **THEN** the app SHALL display matching cards and their open listings

### Requirement: List a card for sale
The web app SHALL let a connected seller list a card they own at a stated price, signing the listing transaction in their wallet.

#### Scenario: Seller lists a card
- **WHEN** a connected seller selects an owned card, sets a price, and confirms
- **THEN** the app SHALL have them sign the `list` transaction
- **AND** on success SHALL show the card as an open listing

### Requirement: Make and withdraw offers
The web app SHALL let a connected buyer make an offer on a listing and withdraw an unaccepted offer, signing each action in their wallet.

#### Scenario: Buyer makes an offer
- **WHEN** a connected buyer enters an offer amount and confirms
- **THEN** the app SHALL have them sign the `make_offer` transaction
- **AND** SHALL show the offer as open with funds held in escrow

#### Scenario: Buyer withdraws an offer
- **WHEN** a buyer withdraws an unaccepted offer
- **THEN** the app SHALL have them sign the `withdraw_offer` transaction
- **AND** on success SHALL show the escrowed funds returned

### Requirement: Accept an offer and buy now
The web app SHALL let a seller accept an offer and let a buyer buy at the asking price, each settling the trade atomically.

#### Scenario: Seller accepts an offer
- **WHEN** a seller accepts an open offer and confirms
- **THEN** the app SHALL have them sign the `accept_offer` transaction
- **AND** on success SHALL show the trade as settled

#### Scenario: Buyer buys now
- **WHEN** a buyer chooses buy-now on a listing and confirms
- **THEN** the app SHALL have them sign the `buy_now` transaction
- **AND** on success SHALL show the trade as settled and the card transferred

### Requirement: Verifiable trade history
The web app SHALL show trade history with the full settlement breakdown and a link to inspect each settlement on a block explorer.

#### Scenario: Inspect a settled trade
- **WHEN** a user views a settled trade
- **THEN** the app SHALL display price, platform fee, creator royalty, the seller's net proceeds, and a link opening the settlement transaction on a block explorer

#### Scenario: Primary sale shows no royalty
- **WHEN** a user views a settled trade where the seller was the card's creator
- **THEN** the app SHALL show the creator royalty as zero (or omit the royalty line)
- **AND** SHALL display the seller's proceeds as price minus the platform fee

### Requirement: Listings disclose the creator royalty
The web app SHALL disclose a card's creator royalty on its listing so a buyer or seller sees the royalty before trading.

#### Scenario: Royalty shown on a listing
- **WHEN** a user views a listing for a card with a non-zero creator royalty
- **THEN** the app SHALL display the creator royalty rate
- **AND** SHALL indicate the royalty is paid to the card's creator on sale


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

### Requirement: Pay for a card with any held asset

The web app SHALL let a buyer choose a source asset other than USDC when buying a
card or making an offer, display a live conversion quote before they commit, and
sequence the optional conversion ahead of the unchanged settlement step. The
source-asset picker SHALL default to USDC so existing behavior is preserved.

#### Scenario: Buyer selects a non-USDC asset and sees a quote

- **WHEN** a buyer opens the buy or offer modal and selects a source asset such
  as XLM
- **THEN** the app SHALL show a live quote ("You pay ~X XLM → seller receives Y
  USDC") including the slippage cap before the buyer confirms

#### Scenario: Buyer converts then settles

- **WHEN** the buyer confirms a purchase funded by a non-USDC asset
- **THEN** the app SHALL prompt the buyer to sign the path-payment conversion
  first, and on its confirmation proceed to the existing `buy_now` /
  `accept_offer` settlement step

#### Scenario: USDC trustline prompt

- **WHEN** the API reports the buyer lacks a USDC trustline
- **THEN** the app SHALL prompt the buyer to sign a `change_trust` transaction
  before the conversion

#### Scenario: Buyer already holds enough USDC

- **WHEN** the buyer's USDC balance already covers the amount
- **THEN** the app SHALL skip the conversion step and go straight to settlement,
  unchanged from today's flow

### Requirement: Passkey connect option

The web app SHALL offer a passkey ("Pay with Face ID") connection path alongside the existing extension/keypair wallet connectors, and SHALL track a connected smart-wallet account distinctly from a classic keypair account.

#### Scenario: Consumer connects with a passkey

- **WHEN** a visitor opens the wallet-connect surface on a passkey-capable device
- **THEN** a "Pay with Face ID" / passkey option is presented alongside the existing connectors
- **AND** selecting it connects a smart-wallet account whose `C…` address drives "my listings", balances, and checkout

#### Scenario: Existing connectors remain available

- **WHEN** a user prefers an extension or keypair wallet
- **THEN** the existing `@creit.tech/stellar-wallets-kit` connect flow remains available and unchanged as the default for sellers and power users

### Requirement: Face ID checkout flow

The web app SHALL provide a single-confirm checkout for `buy_now` and `make_offer` when connected via passkey: a biometric prompt followed by a clear pending → success (or retryable error) state, without an extension popup.

#### Scenario: One-tap buy

- **WHEN** a passkey-connected consumer taps "Buy now" on a real listing
- **THEN** the app triggers one biometric prompt to authorize the purchase
- **AND** shows a pending state while the transaction is relayed
- **AND** transitions to a success state reflecting the completed on-chain settlement

#### Scenario: Checkout error is recoverable

- **WHEN** authorization is declined or submission fails
- **THEN** the checkout returns to a cancellable, retryable state
- **AND** the listing is not shown as purchased


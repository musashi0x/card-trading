## Purpose

Serve catalog and search from the Postgres mirror, build and submit unsigned Stellar transactions for trade actions, and reconcile on-chain state back into the mirror.
## Requirements
### Requirement: Card and listing catalog
The API SHALL expose endpoints to browse and search cards and open listings, served from the Postgres mirror, including each card's creator and royalty rate.

#### Scenario: Browse open listings
- **WHEN** a client requests the listings catalog
- **THEN** the API SHALL return open listings with card metadata, price, seller, and the card's creator and royalty rate
- **AND** results SHALL be served from Postgres for fast response

#### Scenario: Search cards
- **WHEN** a client searches by card name, set, or rarity
- **THEN** the API SHALL return matching cards and their open listings

### Requirement: Transaction building for trade actions
The API SHALL build unsigned Stellar transactions for list, cancel, make-offer, withdraw-offer, accept-offer, and buy-now so the client can sign them in the user's wallet.

#### Scenario: Build a make-offer transaction
- **WHEN** a buyer requests to make an offer on a listing
- **THEN** the API SHALL return an unsigned transaction invoking the contract's `make_offer`
- **AND** the API SHALL NOT hold or use the buyer's private key

#### Scenario: Pre-flight validation before building
- **WHEN** building a transaction that requires a trustline or sufficient balance
- **THEN** the API SHALL validate the prerequisite
- **AND** SHALL return a clear, actionable error if it is not met

### Requirement: Chain indexer reconciles state to Postgres
The API SHALL run an indexer that reconciles on-chain listing, offer, and settlement state into the Postgres mirror, treating the chain as the source of truth, and SHALL record the creator royalty distributed at settlement.

#### Scenario: Settlement reflected after a trade
- **WHEN** a trade settles on-chain
- **THEN** the indexer SHALL update the listing to sold, the offer to settled, and record a trade row with the settlement transaction hash, platform fee, and creator royalty amount

#### Scenario: Reconcile on action
- **WHEN** a user completes a contract action
- **THEN** the API SHALL reconcile the affected records from chain state shortly afterward
- **AND** the chain state SHALL take precedence over any prior DB state

### Requirement: Trade history with verifiable references
The API SHALL expose trade history where each settled trade includes the on-chain settlement transaction hash and the full fund distribution.

#### Scenario: View a settled trade
- **WHEN** a client requests trade history
- **THEN** each trade SHALL include buyer, seller, price, platform fee, creator royalty amount, and a settlement transaction hash usable to look it up on a block explorer

### Requirement: Pre-flight validates the creator trustline before settlement
The API SHALL validate that the card creator can receive their royalty before building a settlement transaction that pays a non-zero royalty.

#### Scenario: Creator missing a USDC trustline
- **WHEN** building an `accept_offer` or `buy_now` transaction for a card with a non-zero royalty
- **THEN** the API SHALL validate the creator's USDC trustline
- **AND** SHALL return a clear, actionable error if it is not met


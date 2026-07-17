# card-assets

## MODIFIED Requirements

### Requirement: Cards represented as on-chain NFTs

Each card copy SHALL be a unique non-fungible token in the platform's global
collection contract, identified by a `token_id` with a per-card serial.

#### Scenario: Card copy maps to a token

- **WHEN** a card is registered in the system
- **THEN** each of its copies SHALL map to a unique token id in the collection
- **AND** each copy SHALL carry a serial equal to its mint order within the
  card

#### Scenario: Card metadata stored off-chain

- **WHEN** a card is registered
- **THEN** its display metadata (name, set, rarity, image URL, supply) SHALL
  be stored in Postgres
- **AND** the collection contract SHALL remain the source of truth for
  per-copy ownership

### Requirement: Card issuance on testnet

Card copies SHALL be issued by minting on the collection contract,
server-signed by the platform owner account.

#### Scenario: Issue a card

- **WHEN** an operator mints a new card with `supply` copies
- **THEN** `supply` tokens SHALL exist in the collection owned by the target
  wallet
- **AND** the card record and its per-copy rows SHALL be created in Postgres

#### Scenario: Issue test payment currency

- **WHEN** the platform provisions test USDC for a wallet
- **THEN** the existing fungible USDC issuance flow SHALL be used unchanged

### Requirement: Cards carry a creator account and royalty rate

A card's creator and royalty rate SHALL be registered on the collection at
mint time and apply to all of its copies.

#### Scenario: Card registered with a creator royalty

- **WHEN** a card is minted with a royalty rate above zero
- **THEN** the collection SHALL record the creator and rate for each minted
  token
- **AND** secondary sales through the settlement contract SHALL pay the
  royalty

#### Scenario: Card registered without a royalty

- **WHEN** a card is minted with a zero royalty rate
- **THEN** settlement SHALL treat the sale as a two-way split with no royalty
  leg

## REMOVED Requirements

### Requirement: Holder can establish a trustline to a card asset

**Reason**: NFT ownership is collection-contract storage; no trustline exists
or is needed. All `MISSING_TRUSTLINE` preflight and self-heal flows are
deleted with it.

**Migration**: Buyer/seller preflights become `owner_of` contract queries;
recipients need no setup to receive a card.

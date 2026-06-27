## Purpose

Represent each tradable card and the test payment currency as on-chain Stellar assets the settlement contract can move uniformly, with off-chain metadata mirrored in Postgres.
## Requirements
### Requirement: Cards represented as on-chain Stellar assets
The system SHALL represent each tradable card as a Stellar Asset (identified by asset code and issuer) that is usable through the standard Stellar token interface, so the settlement contract can move cards and payment tokens uniformly.

#### Scenario: Card maps to a Stellar asset
- **WHEN** a card is registered in the system
- **THEN** it SHALL have a deterministic mapping to a Stellar asset (asset code + issuer)
- **AND** that asset SHALL be transferable via the standard token interface used by the settlement contract

#### Scenario: Card metadata stored off-chain
- **WHEN** a card is registered
- **THEN** its display metadata (name, set, rarity, image URL, supply) SHALL be stored in Postgres
- **AND** the on-chain asset SHALL remain the source of truth for ownership

### Requirement: Card issuance on testnet
The system SHALL be able to issue card assets and a test USDC-equivalent stablecoin on Stellar testnet for use in trading.

#### Scenario: Issue a card asset
- **WHEN** an operator issues a new card asset
- **THEN** the asset SHALL exist on testnet with a defined supply
- **AND** the corresponding card record SHALL be created in Postgres with its metadata

#### Scenario: Issue test payment currency
- **WHEN** the marketplace is initialized
- **THEN** a test USDC-equivalent asset SHALL be available on testnet for pricing and payment
- **AND** the UI SHALL clearly label it as test currency

### Requirement: Holder can establish a trustline to a card asset
The system SHALL allow a user's Stellar account to establish a trustline to a card asset so it can receive that card on settlement.

#### Scenario: Buyer lacks a trustline before purchase
- **WHEN** a buyer attempts to acquire a card to which their account has no trustline
- **THEN** the system SHALL prompt the buyer to establish the trustline before settlement
- **AND** settlement SHALL NOT proceed until the trustline exists

### Requirement: Cards carry a creator account and royalty rate
The system SHALL record, for each card, an on-chain creator payout account and an immutable royalty rate (basis points) as part of issuance/registration, so the settlement contract can pay the creator on resale.

#### Scenario: Card registered with a creator royalty
- **WHEN** an operator issues or registers a card with a creator account and royalty rate
- **THEN** the system SHALL store the creator account and royalty rate alongside the card's metadata in Postgres
- **AND** SHALL register the same creator and rate in the settlement contract's royalty registry

#### Scenario: Card registered without a royalty
- **WHEN** a card is registered with no creator royalty specified
- **THEN** the system SHALL default its royalty rate to zero
- **AND** the card SHALL remain tradable, settling as a two-way split

#### Scenario: Creator can receive the royalty asset
- **WHEN** a card with a non-zero royalty is registered
- **THEN** the creator account SHALL have a USDC trustline established before that card can settle a sale


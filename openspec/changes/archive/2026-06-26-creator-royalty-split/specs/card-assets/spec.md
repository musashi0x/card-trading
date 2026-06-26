## ADDED Requirements

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

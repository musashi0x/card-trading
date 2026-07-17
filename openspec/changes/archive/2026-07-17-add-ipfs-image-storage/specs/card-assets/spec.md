## MODIFIED Requirements

### Requirement: Cards represented as on-chain Stellar assets
The system SHALL represent each tradable card as a Stellar Asset (identified by asset code and issuer) that is usable through the standard Stellar token interface, so the settlement contract can move cards and payment tokens uniformly.

#### Scenario: Card maps to a Stellar asset
- **WHEN** a card is registered in the system
- **THEN** it SHALL have a deterministic mapping to a Stellar asset (asset code + issuer)
- **AND** that asset SHALL be transferable via the standard token interface used by the settlement contract

#### Scenario: Card metadata stored off-chain
- **WHEN** a card is registered
- **THEN** its display metadata (name, set, rarity, image URL, supply) SHALL be stored in Postgres
- **AND** when an IPFS provider is configured, the image URL SHALL be a content-addressed `ipfs://<CID>` reference to the pinned image rather than the image bytes themselves
- **AND** the on-chain asset SHALL remain the source of truth for ownership

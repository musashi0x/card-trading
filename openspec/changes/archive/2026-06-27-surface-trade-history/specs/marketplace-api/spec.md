## MODIFIED Requirements

### Requirement: Trade history with verifiable references
The API SHALL expose trade history where each settled trade includes the on-chain settlement transaction hash and the full fund distribution. The endpoint SHALL accept an optional `account` query parameter; when supplied, only trades where that address is the buyer or the seller SHALL be returned.

#### Scenario: View a settled trade
- **WHEN** a client requests trade history
- **THEN** each trade SHALL include buyer, seller, price, platform fee, creator royalty amount, and a settlement transaction hash usable to look it up on a block explorer

#### Scenario: Filter trade history to a wallet

- **WHEN** a client requests `GET /api/trades?account=<address>`
- **THEN** the API SHALL return only trades where the given address is the buyer or the seller
- **AND** the response shape SHALL be identical to the unfiltered response

#### Scenario: Omitting the account parameter returns all trades

- **WHEN** a client requests `GET /api/trades` without an `account` parameter
- **THEN** the API SHALL return all settled trades ordered newest-first, unchanged from existing behavior

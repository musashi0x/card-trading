## MODIFIED Requirements

### Requirement: Verifiable trade history
The web app SHALL show trade history with the full settlement breakdown and a link to inspect each settlement on a block explorer.

#### Scenario: Inspect a settled trade
- **WHEN** a user views a settled trade
- **THEN** the app SHALL display price, platform fee, creator royalty, the seller's net proceeds, and a link opening the settlement transaction on a block explorer

#### Scenario: Primary sale shows no royalty
- **WHEN** a user views a settled trade where the seller was the card's creator
- **THEN** the app SHALL show the creator royalty as zero (or omit the royalty line)
- **AND** SHALL display the seller's proceeds as price minus the platform fee

## ADDED Requirements

### Requirement: Listings disclose the creator royalty
The web app SHALL disclose a card's creator royalty on its listing so a buyer or seller sees the royalty before trading.

#### Scenario: Royalty shown on a listing
- **WHEN** a user views a listing for a card with a non-zero creator royalty
- **THEN** the app SHALL display the creator royalty rate
- **AND** SHALL indicate the royalty is paid to the card's creator on sale

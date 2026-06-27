## ADDED Requirements

### Requirement: Trade history view

The web app SHALL provide a dedicated trade-history page at `/trades` that renders settled trades returned by `useTrades()`, displaying the full settlement split and a block-explorer link for each trade.

#### Scenario: View the global trade feed

- **WHEN** any user (connected or not) navigates to the History page
- **THEN** the app SHALL display all settled trades ordered newest-first, each showing buyer, seller, gross price, platform fee, creator royalty, seller net, settle time, and a link to the settlement transaction on the block explorer

#### Scenario: Filter to my trades

- **WHEN** a connected wallet holder activates the "My trades" toggle
- **THEN** the app SHALL refetch trades filtered to that wallet address as buyer or seller
- **AND** SHALL hide trades that do not involve the connected wallet

#### Scenario: Empty state

- **WHEN** no settled trades exist (or none match the active filter)
- **THEN** the app SHALL display a clear empty-state message rather than a blank or errored page

#### Scenario: History nav entry

- **WHEN** any page in the marketplace is active
- **THEN** the top nav SHALL include a "History" link that navigates to `/trades`
- **AND** the link SHALL be visually marked active when the current pathname is `/trades`

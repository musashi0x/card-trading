## ADDED Requirements

### Requirement: Heart toggle reflects persisted watchlist state

The heart icon on each `CardTile` SHALL reflect the server-backed watchlist state
for the connected wallet. The toggle SHALL feel instant via optimistic UI and roll
back on error. When no wallet is connected, tapping the heart SHALL invoke the
wallet connect flow rather than silently no-op.

#### Scenario: Connected wallet watches a listing
- **WHEN** a connected wallet taps the heart on an open listing
- **THEN** the heart flips to active immediately (optimistic)
- **AND** `POST /api/watchlist` is called in the background
- **AND** on success the server-backed watchlist reflects the new entry

#### Scenario: Connected wallet un-watches a listing
- **WHEN** a connected wallet taps an active heart
- **THEN** the heart reverts to inactive immediately (optimistic)
- **AND** `DELETE /api/watchlist/:listingId` is called in the background
- **AND** on API error the heart is restored to its prior state

#### Scenario: No wallet connected — tap prompts to connect
- **WHEN** a visitor without a connected wallet taps the heart
- **THEN** the app SHALL invoke the wallet connect flow
- **AND** the heart SHALL NOT flip to watched

#### Scenario: Watchlist reloads correctly after page refresh
- **WHEN** a connected wallet reloads the page
- **THEN** the heart icons on watched listings SHALL reflect the persisted state
  fetched from `GET /api/watchlist?account=<address>`

### Requirement: My-bids Watchlist section uses persisted data

The "Watchlist" grid in the My-bids Bidding tab SHALL be populated from the
server-backed `useWatchlist` query rather than from local React state. When no
wallet is connected, the section SHALL show a prompt to connect instead of an
empty grid.

#### Scenario: Watchlist grid shows persisted entries
- **WHEN** a connected wallet opens the My-bids / Bidding tab
- **THEN** the Watchlist section SHALL display all listings the wallet is watching
  as fetched from `GET /api/watchlist?account=<address>`

#### Scenario: Empty watchlist shows empty state
- **WHEN** a wallet has no watchlist entries
- **THEN** the Watchlist section SHALL be hidden or show an empty-state prompt

#### Scenario: Not-connected watchlist shows connect prompt
- **WHEN** a visitor opens My-bids without a connected wallet
- **THEN** the Watchlist section SHALL display a prompt to connect a wallet
- **AND** SHALL NOT display an empty grid without context

#### Scenario: Closed listing disappears from Watchlist grid
- **WHEN** a listing in the wallet's watchlist closes (sold or cancelled)
- **THEN** on the next query refresh the listing SHALL no longer appear in the
  Watchlist grid

## MODIFIED Requirements

### Requirement: Wallet connection
The web app SHALL let a user connect a Stellar wallet (Freighter) and display their connected address.

#### Scenario: User connects a wallet
- **WHEN** a user clicks connect and approves in the wallet
- **THEN** the app SHALL display the connected Stellar address
- **AND** subsequent trade actions SHALL be signed through that wallet
- **AND** the watchlist SHALL load from the server for the connected address

#### Scenario: Wallet not installed
- **WHEN** a user attempts to connect without the wallet available
- **THEN** the app SHALL show guidance on installing the wallet

# Capability: watchlist

## Purpose

A connected wallet can add or remove any open listing from its watchlist. The
watchlist persists across page reloads and devices, is keyed by wallet address
and listing id, and drives the heart icon on card tiles and the Watchlist grid
in the My-bids page. Rows are automatically removed when the corresponding
listing closes.

## ADDED Requirements

### Requirement: Add a listing to the watchlist

A connected wallet SHALL be able to add any open listing to its watchlist; the
entry SHALL be stored server-side and survive page reloads and new devices.

#### Scenario: Connected wallet watches a listing
- **WHEN** a connected wallet taps the heart on an open listing
- **THEN** a `watchlist` row SHALL be created for `(account, listing_id)`
- **AND** the heart icon SHALL reflect the watched state immediately (optimistic)

#### Scenario: Duplicate watch is a no-op
- **WHEN** a wallet watches a listing it already watches
- **THEN** the API SHALL succeed silently (`ON CONFLICT DO NOTHING`)
- **AND** the watchlist SHALL contain exactly one entry for that pair

#### Scenario: Wallet not connected
- **WHEN** a visitor taps the heart without a connected wallet
- **THEN** the app SHALL invoke the wallet connect flow instead of creating an entry
- **AND** the heart SHALL NOT flip to watched until the wallet connects and the
  POST succeeds

#### Scenario: Listing does not exist
- **WHEN** a POST is made with a `listing_id` that does not exist in the DB
- **THEN** the API SHALL reject the request with a `404` error

### Requirement: Remove a listing from the watchlist

A connected wallet SHALL be able to remove any entry from its watchlist; the
removal SHALL be reflected immediately in the UI and persisted to the server.

#### Scenario: Connected wallet un-watches a listing
- **WHEN** a connected wallet taps the active heart on a watched listing
- **THEN** the `watchlist` row for `(account, listing_id)` SHALL be deleted
- **AND** the heart icon SHALL revert to inactive immediately (optimistic)

#### Scenario: Remove a non-existent entry is a no-op
- **WHEN** a DELETE is issued for a `(account, listing_id)` pair that does not exist
- **THEN** the API SHALL respond with `200` and no error

### Requirement: Retrieve the watchlist for a wallet

The API SHALL return all open listings that a wallet is currently watching,
including full card and listing data, ordered by watch creation date descending.

#### Scenario: Fetch a populated watchlist
- **WHEN** a client fetches `GET /api/watchlist?account=<address>`
- **THEN** the API SHALL return an array of listing+card objects for all open
  listings the wallet is watching, ordered by `watchlist.created_at DESC`

#### Scenario: Fetch an empty watchlist
- **WHEN** a client fetches the watchlist for a wallet with no entries
- **THEN** the API SHALL return an empty array

### Requirement: Watchlist rows are cleaned up when a listing closes

When the indexer reconciles a listing as `sold` or `cancelled`, all watchlist rows for that listing SHALL be deleted atomically in the same DB transaction.

#### Scenario: Watchlist cleaned up on listing close
- **WHEN** the indexer marks a listing as `sold` or `cancelled`
- **THEN** all `watchlist` rows with that `listing_id` SHALL be deleted
- **AND** subsequent GET calls SHALL not include that listing for any watcher

#### Scenario: Closed listing is not included in watchlist GET
- **WHEN** a wallet's watchlist contains a listing that has since closed
- **THEN** the GET endpoint SHALL not return that listing (filtered by join on `listings.status = 'open'`)

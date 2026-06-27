## ADDED Requirements

### Requirement: Watchlist CRUD endpoints

The API SHALL expose three endpoints for managing a wallet's watchlist:
`GET /api/watchlist?account=<address>` returns the current watchlist with full
listing + card data; `POST /api/watchlist` adds a listing; `DELETE
/api/watchlist/:listingId?account=<address>` removes it. All three use the wallet
address as the only identity token (no JWT), matching the pattern of
`GET /api/orders?account=…`. Write endpoints SHALL validate the listing exists
before inserting. Duplicate inserts SHALL use `ON CONFLICT DO NOTHING`.

#### Scenario: Fetch the watchlist for a connected wallet
- **WHEN** a client issues `GET /api/watchlist?account=<address>`
- **THEN** the API SHALL return all watchlist entries for that account where the
  corresponding listing is still `open`, joined with listing and card data,
  ordered by `watchlist.created_at DESC`

#### Scenario: Add a listing to the watchlist
- **WHEN** a client issues `POST /api/watchlist` with `{ account, listingId }`
- **THEN** the API SHALL insert a `watchlist` row for the pair and return `201`
- **AND** if the row already exists the API SHALL return `200` without error
- **AND** if the `listingId` does not exist the API SHALL return `404`

#### Scenario: Remove a listing from the watchlist
- **WHEN** a client issues `DELETE /api/watchlist/:listingId?account=<address>`
- **THEN** the API SHALL delete the matching row (if it exists) and return `200`

#### Scenario: Watchlist rows deleted when a listing closes
- **WHEN** the indexer marks a listing as `sold` or `cancelled`
- **THEN** all `watchlist` rows for that `listing_id` SHALL be deleted in the
  same DB transaction as the status update

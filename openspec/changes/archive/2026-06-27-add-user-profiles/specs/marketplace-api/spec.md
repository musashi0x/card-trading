## ADDED Requirements

### Requirement: Retrieve and update a user profile by Stellar address

The API SHALL expose `GET /api/profiles/:address` and `PUT /api/profiles/:address`
following the same Express Router pattern as the existing `trades` and `catalog`
routes. The GET endpoint creates a `users` row with null optional fields if one
does not yet exist, so the web client never receives a 404 for a known wallet.

#### Scenario: GET returns profile for a connected wallet

- **WHEN** a client sends `GET /api/profiles/G…ABC`
- **THEN** the API SHALL return `200` with a JSON object matching
  `{ stellarAddress, displayName, bio, location, website, avatarUrl, memberSince }`

#### Scenario: PUT persists profile edits

- **WHEN** a client sends `PUT /api/profiles/G…ABC` with a valid body
- **THEN** the API SHALL upsert the `users` row and return `200` with the
  updated profile; no other rows SHALL be modified

#### Scenario: GET for an unknown address auto-creates the row

- **WHEN** a client sends `GET /api/profiles/G…BRAND_NEW` for an address not yet in `users`
- **THEN** the API SHALL insert a row with `stellar_address = G…BRAND_NEW` and
  all optional fields null, then return `200` — not `404`

### Requirement: Profile stats endpoint

The API SHALL expose `GET /api/profiles/:address/stats` that returns aggregate
statistics derived from `trades`, `listings`, and `reviews` rows without
materialising them in the `users` table.

#### Scenario: Stats returned for an active trader

- **WHEN** a client calls `GET /api/profiles/G…ABC/stats`
- **THEN** the API SHALL return `200` with
  `{ collectionValueUsdc, cardsOwned, cardsSold, sellerRating, winRate, achievements }`
  where each value is computed from live Postgres rows

#### Scenario: Stats endpoint never returns 404

- **WHEN** a client calls the stats endpoint for any address (even one with no activity)
- **THEN** the API SHALL return `200` with zero/null values rather than `404`

### Requirement: Reviews endpoints

The API SHALL expose `GET /api/profiles/:address/reviews` (returns all reviews
for the address, newest first) and `POST /api/profiles/:address/reviews` (inserts
a new review, enforcing one review per reviewer per trade and counterparty-only
writes).

#### Scenario: List reviews for a seller

- **WHEN** a client calls `GET /api/profiles/G…SELLER/reviews`
- **THEN** the API SHALL return `200` with an array of
  `{ id, reviewerAddress, rating, text, createdAt }` ordered by `created_at DESC`

#### Scenario: Post review — happy path

- **WHEN** a valid counterparty POSTs `{ tradeId, rating, text }`
- **THEN** the API SHALL return `201` with the new review row

#### Scenario: Post review — duplicate rejected

- **WHEN** a reviewer posts for a `tradeId` they have already reviewed
- **THEN** the API SHALL return `409` with code `DUPLICATE_REVIEW`

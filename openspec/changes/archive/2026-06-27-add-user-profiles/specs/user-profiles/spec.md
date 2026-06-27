## ADDED Requirements

### Requirement: Persisted user profile

The system SHALL store a user's profile fields (display name, bio, location,
website URL, avatar URL) in Postgres and return them via
`GET /api/profiles/:address`. Any authenticated caller with the matching wallet
address SHALL be able to update those fields via
`PUT /api/profiles/:address`.

#### Scenario: Fetch a profile that has been saved

- **WHEN** a client calls `GET /api/profiles/G…ABC`
- **AND** that address has previously called `PUT` to save a bio and location
- **THEN** the API SHALL return `200` with `{ stellarAddress, displayName, bio, location, website, avatarUrl, memberSince }` reflecting the saved values

#### Scenario: Fetch a profile that has never been edited

- **WHEN** a client calls `GET /api/profiles/G…NEW` for an address that exists in `users` but has no profile edits
- **THEN** the API SHALL return `200` with `null` for all optional fields and `memberSince` set to the account's `created_at` date

#### Scenario: Update a profile

- **WHEN** a caller sends `PUT /api/profiles/G…ABC` with a valid JSON body containing `bio`, `location`, `website`, and `avatarUrl`
- **THEN** the API SHALL upsert the row in `users`, return `200` with the updated profile, and subsequent `GET` calls for the same address SHALL reflect the new values

#### Scenario: Update with a partial body

- **WHEN** a caller sends `PUT /api/profiles/G…ABC` with only `{ bio: "new bio" }`
- **THEN** the API SHALL update only `bio` and leave other fields unchanged

### Requirement: Profile stats derived from on-chain trade data

`GET /api/profiles/:address/stats` SHALL return statistics computed from the
live `trades` and `listings` rows: collection value (sum of `price_usdc` for
cards the address has bought and not subsequently sold), cards owned (open
listings count), cards sold (settled trades where seller = address), seller
rating (average review rating), and win rate (trades won as buyer ÷ total offers
made).

#### Scenario: Stats for a user who has made trades

- **WHEN** a client calls `GET /api/profiles/G…ABC/stats`
- **AND** that address has at least one completed trade as buyer and one as seller
- **THEN** the API SHALL return `{ collectionValueUsdc, cardsOwned, cardsSold, sellerRating, winRate }` with values derived from the `trades` table

#### Scenario: Stats for a brand-new user

- **WHEN** a client calls `GET /api/profiles/G…NEW/stats` for an address with no trades or listings
- **THEN** the API SHALL return `{ collectionValueUsdc: "0", cardsOwned: 0, cardsSold: 0, sellerRating: null, winRate: null }`

#### Scenario: Seller rating reflects average of reviews

- **WHEN** three counterparty reviews exist for address `G…SELLER` with ratings 4, 5, and 5
- **THEN** the stats endpoint SHALL return `sellerRating` of `4.67` (rounded to 2 d.p.)

### Requirement: Counterparty reviews

The API SHALL allow any user who has completed a trade with an address to post
one text review with a 1–5 star integer rating for that counterparty. Reviews
SHALL be public, and the API SHALL enforce at most one review per reviewer per
trade.

#### Scenario: Post a valid review

- **WHEN** a buyer who completed trade `T1` with seller `G…SELLER` sends
  `POST /api/profiles/G…SELLER/reviews` with `{ tradeId: "T1", rating: 5, text: "Fast shipping" }`
- **THEN** the API SHALL insert the review, return `201`, and the review SHALL appear in `GET /api/profiles/G…SELLER/reviews`

#### Scenario: Duplicate review is rejected

- **WHEN** the same reviewer sends a second `POST` for the same `tradeId`
- **THEN** the API SHALL return `409 DUPLICATE_REVIEW` and SHALL NOT insert a second row

#### Scenario: Non-counterparty review is rejected

- **WHEN** an address that was NOT buyer or seller in the referenced trade sends a review POST
- **THEN** the API SHALL return `403 NOT_COUNTERPARTY`

#### Scenario: Rating out of range is rejected

- **WHEN** a caller sends `POST` with `rating: 6`
- **THEN** the API SHALL return `400 INVALID_RATING`

### Requirement: Achievement badges derived from activity

The profile stats response SHALL include an `achievements` array where each
badge is marked `unlocked: true` or `false` based on thresholds computed from
the user's trades and listings.

#### Scenario: First-win badge unlocked after first purchase

- **WHEN** a user has completed at least one trade as buyer
- **THEN** the `first-win` achievement SHALL be returned with `unlocked: true`

#### Scenario: Century-club badge locked until 100 cards collected

- **WHEN** a user has bought fewer than 100 cards total
- **THEN** the `century-club` achievement SHALL be returned with `unlocked: false`

#### Scenario: Big-spender badge unlocked after high-value single trade

- **WHEN** any single trade where the user was buyer has `price_usdc >= 10000`
- **THEN** the `big-spender` achievement SHALL be returned with `unlocked: true`

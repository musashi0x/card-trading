# Capability: marketplace-api (MODIFIED)

## ADDED Requirements

### Requirement: Leaderboard aggregation endpoint

The API SHALL expose `GET /api/leaderboard` accepting `board` (`collectors` |
`sellers` | `traders`), optional `account` (Stellar address), and optional
`limit` (integer 1–100, default 50). The response SHALL include a `rows` array
of ranked entries for the requested board and an `ownStanding` object for the
requesting account (or `null` when `account` is omitted). Board rows SHALL be
cached in-process for 5 minutes keyed on `(board, limit)`; the `ownStanding`
lookup SHALL NOT be cached. Metric definitions follow the `marketplace-leaderboard`
capability spec. A missing `board` parameter SHALL return HTTP 400.

#### Scenario: Fetch the collectors board

- **WHEN** a client requests `GET /api/leaderboard?board=collectors&limit=10&account=G…`
- **THEN** the API SHALL return HTTP 200 with `{ rows: [...], ownStanding: {...}, ratingAvailable: null }`
- **AND** `rows` SHALL contain at most 10 entries ranked by `collectionValue` descending
- **AND** `ownStanding` SHALL reflect the requesting account's season collection value and rank

#### Scenario: Missing board parameter returns 400

- **WHEN** a client calls `GET /api/leaderboard` without a `board` parameter
- **THEN** the API SHALL return HTTP 400 with `{ error: "board: Required", code: "VALIDATION" }`

#### Scenario: Sellers board with reviews table absent

- **WHEN** a client requests `board=sellers` and the `reviews` table does not exist in Postgres
- **THEN** the API SHALL return HTTP 200 with `ratingAvailable: false`
- **AND** every row SHALL have `avgRating: null`
- **AND** the board SHALL be ranked by `salesVolume90d` normally

#### Scenario: Cache hit serves stale-within-TTL board rows

- **WHEN** the same `(board, limit)` combination is requested a second time within 5 minutes
- **THEN** the API SHALL return the cached `rows` without re-running the aggregation query
- **AND** `ownStanding` SHALL still be freshly computed from Postgres on every request

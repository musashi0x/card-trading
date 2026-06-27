## ADDED Requirements

### Requirement: Profile page displays real persisted data

The `/profile` page SHALL fetch the connected wallet's profile from
`GET /api/profiles/:address` and stats from `GET /api/profiles/:address/stats`
via TanStack Query hooks, replacing all static panel data. The static
`PROFILE_STATS`, `PROFILE_ACHIEVEMENTS`, `PROFILE_ACTIVITY`, and `PROFILE_REVIEWS`
constants from `panels.ts` SHALL NOT be imported or rendered.

#### Scenario: Connected user views their profile

- **WHEN** a user with a connected wallet navigates to `/profile`
- **THEN** the page SHALL display their saved `displayName`, `bio`, `location`,
  `website`, and `memberSince` fetched from the API
- **AND** the stats section SHALL show `collectionValueUsdc`, `cardsOwned`,
  `cardsSold`, `sellerRating`, and `winRate` derived from real trade data

#### Scenario: Profile page shows empty state for a new user

- **WHEN** a freshly connected wallet with no trades or profile edits visits `/profile`
- **THEN** the page SHALL render null/zero values (e.g. "—" for rating) rather
  than the static mock numbers
- **AND** SHALL NOT display `cardwizard_88` or any other hard-coded user data

#### Scenario: Profile shows live reviews from counterparties

- **WHEN** another user has posted a review for this wallet address
- **THEN** the reviews section SHALL display that review with reviewer address,
  star rating, text, and relative timestamp fetched from
  `GET /api/profiles/:address/reviews`

#### Scenario: Achievements reflect real activity

- **WHEN** a user has completed at least one trade as buyer
- **THEN** the `first-win` achievement badge SHALL render as unlocked
- **AND** badges for thresholds not yet reached SHALL render as locked

### Requirement: Profile-edit page persists changes to the API

The `/profile/edit` page SHALL maintain a local form state for editable fields
(displayName, bio, location, website, avatarUrl), call
`PUT /api/profiles/:address` on save, and invalidate the profile query on
success. The in-memory `draft` state and `saveProfile`/`setDraft` helpers in
`TopDeckProvider` SHALL be removed.

#### Scenario: User saves a profile edit

- **WHEN** a user edits their bio on `/profile/edit` and taps Save
- **THEN** the app SHALL call `PUT /api/profiles/:address` with the updated
  fields, navigate back to `/profile`, and the profile page SHALL immediately
  show the new bio without a page reload

#### Scenario: User cancels a profile edit

- **WHEN** a user navigates to `/profile/edit`, makes changes, and taps Cancel
- **THEN** the app SHALL navigate back to `/profile` without calling the API,
  and the profile data SHALL remain unchanged

#### Scenario: Save fails with a network error

- **WHEN** the `PUT /api/profiles/:address` call returns a non-2xx response
- **THEN** the edit page SHALL display an error message and SHALL NOT navigate
  away from `/profile/edit`

# Capability: marketplace-web (MODIFIED)

## ADDED Requirements

### Requirement: Leaderboard page fetches real ranked data

The leaderboard page (`/leaderboard`) SHALL fetch board data from
`GET /api/leaderboard` via a `useLeaderboard` TanStack Query hook backed by a
typed `api.leaderboard()` method in `@/lib/api.ts`. The hook SHALL accept
`board` and `account` parameters and refetch automatically when either changes.
While data is loading the page SHALL render a skeleton or loading state. On
error the page SHALL surface a user-readable message without crashing.

#### Scenario: Leaderboard loads successfully

- **WHEN** a user navigates to `/leaderboard` with a wallet connected
- **THEN** the page SHALL display the active tab's ranked rows from the API
- **AND** the requesting user's own standing SHALL be shown in the "your rank" panel using `ownStanding`
- **AND** secondary stats (cards held, sales count/rating, flips/ROI) SHALL be rendered per row

#### Scenario: Leaderboard tab switch

- **WHEN** a user clicks a different leaderboard tab (collectors / sellers / traders)
- **THEN** the `useLeaderboard` hook SHALL fire a new request with the updated `board` value
- **AND** the ranked list SHALL update to reflect the new board's data
- **AND** the user's own standing panel SHALL update accordingly

#### Scenario: No wallet connected

- **WHEN** a user views the leaderboard without a connected wallet
- **THEN** `account` SHALL be omitted from the API request
- **AND** `ownStanding` SHALL be `null` and the "your rank" panel SHALL be hidden or show a connect prompt

#### Scenario: API error on leaderboard fetch

- **WHEN** the `GET /api/leaderboard` request fails with a non-2xx status
- **THEN** the page SHALL display an error message and a retry affordance
- **AND** the page SHALL NOT crash or render stale static data

## MODIFIED Requirements

### Requirement: Static leaderboard mocks removed from panels.ts

The following exports SHALL be deleted from
`apps/web/src/components/topdeck/panels.ts`:

- `LB_USERS` (static array of mock leaderboard users)
- `LB_YOU` (static per-tab own-standing record)
- `LB_CFGS` (static per-tab display configuration)
- `LB_SUBTITLE` (static per-tab subtitle strings)

The `LbUser` and `LbTab` type definitions SHALL be moved to
`packages/shared/src/types.ts` as `LeaderboardRow` and `LeaderboardBoard`
respectively (or equivalent names consistent with the API response shape) so
both the API and web share the same type. The leaderboard page SHALL import
these types from `@cardmkt/shared` rather than from `panels.ts`.

#### Scenario: panels.ts no longer exports leaderboard mocks

- **WHEN** a developer imports from `@/components/topdeck/panels`
- **THEN** `LB_USERS`, `LB_YOU`, `LB_CFGS`, and `LB_SUBTITLE` SHALL NOT be resolvable exports
- **AND** the TypeScript compiler SHALL reject any remaining import of those identifiers

#### Scenario: Leaderboard page renders without panels.ts data

- **WHEN** the leaderboard page is compiled after the mock removal
- **THEN** it SHALL import leaderboard data exclusively from the `useLeaderboard` hook
- **AND** it SHALL have no remaining static import of `LB_USERS`, `LB_YOU`, `LB_CFGS`, or `LB_SUBTITLE`

#### Scenario: Shared LeaderboardRow type used across packages

- **WHEN** the API serialises a leaderboard response
- **THEN** the response rows SHALL conform to the `LeaderboardRow` interface from `@cardmkt/shared`
- **AND** the web hook's return type SHALL use the same `LeaderboardRow` interface without duplication

#### Scenario: Remaining panels.ts exports unaffected

- **WHEN** other pages import unrelated exports from `panels.ts` (e.g. portfolio, profile, trade panels)
- **THEN** those imports SHALL continue to resolve without error
- **AND** only the four leaderboard-specific exports SHALL be removed

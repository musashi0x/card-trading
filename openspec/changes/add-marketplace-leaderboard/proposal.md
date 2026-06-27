# add-marketplace-leaderboard

## Why

The leaderboard page today is entirely synthetic: every rank, score, and username
is hard-coded in `panels.ts` (`LB_USERS`, `LB_YOU`, `LB_CFGS`, `LB_SUBTITLE`).
A real user who makes trades, builds a collection, or generates sales volume sees
the same twelve fictional "GoldenEraCards" rows no matter what they have actually
done on the platform. The three tabs — collectors, sellers, traders — each promise
a meaningful competitive signal but deliver only prototype data.

The `trades` and `listings` tables already capture every piece of information
needed to rank users authentically: `priceUsdc`/`feeUsdc`/`royaltyUsdc` rows in
`trades`, `seller` and `buyer` fields, `settledAt` timestamps. This change
connects those rows to a real ranking endpoint and replaces every leaderboard mock
with a live-data query hook.

## What Changes

- **New capability `marketplace-leaderboard`**: defines three ranked boards —
  collectors (holdings value this season), sellers (90-day gross sales volume plus
  rating), traders (all-time realized profit / ROI) — each backed by aggregations
  over `trades`, `listings`, and `cards`. Seller rating is sourced from the
  `reviews` table added by the `add-user-profiles` change; the board degrades
  gracefully (omits rating) when that table is absent. The caller's own standing
  is returned alongside the top-N rows in every response.
- **Modified capability `marketplace-api`**: a new route
  `GET /api/leaderboard?board=collectors|sellers|traders&account=<address>&limit=<n>`
  is added, following the same Express Router pattern as `trades.ts` and
  `catalog.ts`. Responses are cached in-process for 5 minutes to contain
  aggregation cost; the cache is keyed on `(board, limit)` so caller-specific
  `account` standing is appended from a lightweight per-account query that is not
  cached.
- **Modified capability `marketplace-web`**: the leaderboard page
  (`/leaderboard`) fetches data via a `useLeaderboard` TanStack Query hook backed
  by `api.leaderboard()`; the static `LB_USERS`, `LB_YOU`, `LB_CFGS`, and
  `LB_SUBTITLE` exports are removed from `panels.ts`.

## Capabilities

### New Capabilities

- `marketplace-leaderboard` — ranked boards for collectors, sellers, and traders
  derived from real on-chain activity, with per-metric definitions and the
  requesting user's own rank/standing.

### Modified Capabilities

- `marketplace-api` — leaderboard endpoint (`GET /api/leaderboard`).
- `marketplace-web` — leaderboard page reads real data; static leaderboard mocks
  removed from `panels.ts`.

## Impact

- **No breaking changes to existing endpoints.** The new route is additive.
- The `LbUser`, `LbTab`, `LB_USERS`, `LB_YOU`, `LB_CFGS`, and `LB_SUBTITLE`
  exports are **REMOVED** from `panels.ts`; callers outside the leaderboard page
  (none exist today) would break. The `LbUser`/`LbTab` types move into the new
  API response type in `@cardmkt/shared`.
- Aggregation queries run against the `trades` and `listings` tables. At current
  expected row counts (< 50 k trades at launch) they execute in < 100 ms; the
  5-minute in-process cache keeps p99 latency at read-path overhead only.
- Seller rating depends on the `reviews` table introduced by `add-user-profiles`.
  If that change ships first, rating is live from day one. If this change ships
  alone, seller rating is omitted from the response and the UI shows "—".

# Design — add-marketplace-leaderboard

## Context

The leaderboard page renders three competitive tabs from static fixtures in
`panels.ts`. The DB already contains all the signal: every settled trade writes a
row to `trades` with `buyer`, `seller`, `priceUsdc`, `feeUsdc`, `royaltyUsdc`,
and `settledAt`; every listing write carries `seller`, `cardId`, and `status`.
The missing piece is an aggregation endpoint and a typed query hook.

The `add-user-profiles` change (parallel) adds a `reviews` table with a per-trade
`rating` column, which is the only external dependency. Both changes can ship
independently; the leaderboard degrades gracefully when `reviews` is absent.

The `add-portfolio-valuation` change (parallel) may eventually supply a
materialized collection-value column per wallet. Until it does, the collectors
board derives value from the last settled `priceUsdc` per card the user has
bought (minus subsequent sells), which is the best available proxy without a
separate valuation oracle.

---

## Goals / Non-Goals

**Goals**
- Three ranked boards, each with a primary metric and secondary stats.
- The requesting user's own rank and metric returned in every response.
- 5-minute server-side cache on the board rows; account standing not cached.
- Graceful degradation when `reviews` table is absent (seller rating omitted).
- Remove all static leaderboard mocks from `panels.ts`.

**Non-Goals**
- Persistent leaderboard snapshots or season-end archiving.
- Pagination beyond the configurable `limit` (first page only at launch).
- Real-time push updates; polling from the UI is sufficient.
- A materialized `leaderboard_snapshots` table (deferred to scale inflection).
- Collection-value oracle integration (blocked on portfolio-valuation change).

---

## Decisions

### Decision 1: Metric definitions

**Collectors — collection value (season window)**

A "collector" holds cards. Value = sum of last buy price across cards the user
currently holds (proxy for market value until a valuation oracle exists). "Holds"
means: count of `buyer = address` in settled trades minus count of `seller =
address`. Season window = calendar year of `settledAt`. Secondary stats: card
count held, win rate (trades won as buyer ÷ total offers made).

- **Alternative rejected:** use open listing prices of held cards as value.
  Rejected because a user with no open listings would show $0; last-trade price is
  the closest consistent proxy.

**Sellers — 90-day gross sales volume + rating**

Sales volume = `SUM(priceUsdc)` where `seller = address` and
`settledAt >= NOW() - INTERVAL '90 days'`. Rating = average `rating` from
`reviews` where `reviewee_address = address` (null when table absent). Secondary
stats: total count of sales in window, average rating.

- **Alternative rejected:** rank by seller net (price minus fee minus royalty).
  Gross volume is the conventional marketplace metric for seller rankings and more
  recognisable to users.

**Traders — all-time realized profit and ROI**

Profit = `SUM(sellerNetUsdc)` for sells − `SUM(priceUsdc)` for buys, across all
time. `sellerNetUsdc = priceUsdc − feeUsdc − royaltyUsdc`. ROI = profit ÷ total
buy cost × 100. Secondary stats: number of completed buy→sell pairs ("flips"),
formatted ROI percentage. The all-time window has no date filter.

- **Alternative rejected:** net present value using current card prices. Too
  complex and requires a valuation oracle; realized P&L from `trades` rows is
  auditable and on-chain.

### Decision 2: Aggregation approach — Drizzle + raw SQL aggregates, no ORM joins

All three boards run a single GROUP BY aggregation query against `trades` using
Drizzle's `sql` helper for the aggregate expressions (`SUM`, `COUNT`, `AVG`).
The collectors board joins a subquery to compute holdings. These are synchronous
Postgres aggregates on an indexed table; expected execution time < 100 ms at
launch volume (< 50 k trades).

- **Alternative rejected:** materialised view / `leaderboard_snapshots` table
  refreshed by a cron job. Adds infrastructure complexity (background job,
  migration, refresh scheduling) before the page even has real users. Revisit if
  p95 aggregation time exceeds 500 ms in production.

### Decision 3: Caching strategy — in-process Map with 5-minute TTL

The board rows (top-N ranked list) are cached in an in-process `Map<string, {
ts: number; rows: LeaderboardRow[] }>` keyed on `${board}:${limit}`. The
requesting account's own standing is fetched separately on every request (not
cached) because it is caller-specific and cheap (a single WHERE filter). Cache
is invalidated lazily on read if `Date.now() - ts > 5 * 60 * 1000`.

- **Alternative rejected:** Redis/Valkey external cache. Adds an infrastructure
  dependency that doesn't exist today. The in-process Map is sufficient for a
  single-instance API; replace with Redis if horizontal scaling is needed.
- **Alternative rejected:** HTTP Cache-Control headers delegated to a CDN.
  The `account` query param makes the full response caller-specific; CDN caching
  would require vary-by-account, which undermines cache hit rate. Splitting board
  rows (cacheable) from account standing (uncacheable) at the endpoint level keeps
  the CDN story simple if we add it later.

### Decision 4: Season window for collectors is calendar year

"This season" for the collectors board is the current calendar year
(`DATE_TRUNC('year', settledAt) = DATE_TRUNC('year', NOW())`). A configurable
season start date (e.g. `SEASON_START_ISO` env var) is the recommended upgrade
path when the product defines a real season cadence.

- **Alternative rejected:** rolling 365-day window. Harder to reason about for
  users ("am I in this season or not?"). Calendar year is simple and predictable.

### Decision 5: Dependency on `reviews` table — graceful degradation

The leaderboard route checks for the existence of the `reviews` table with a
`pg_tables` probe on startup (cached). If the table does not exist the seller
board's `rating` field is `null` in every row and the API response includes
`"ratingAvailable": false`. The web UI renders "—" for rating when this flag is
false.

---

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Aggregation query slow with many trades | Low at launch | 5-min cache + index on `trades(seller, settledAt)` |
| Collectors metric is a proxy, not real value | Medium | Document limitation; superseded by portfolio-valuation change |
| Season window (calendar year) misaligns with product seasons | Low | Move to `SEASON_START_ISO` env var when product defines seasons |
| Rating missing when add-user-profiles ships late | Possible | Graceful null + `ratingAvailable: false` flag |
| In-process cache lost on restart | Low | Stale data risk is 0; cache is warm-through on first request post-restart |

---

## Migration Plan

No schema migrations required. All aggregation runs over the existing `trades`,
`listings`, and `cards` tables. An index on `trades(seller, settledAt)` and
`trades(buyer, settledAt)` (which may already exist from earlier work) is
recommended for query performance; add as a Drizzle migration if missing.

---

## Open Questions

1. When `add-portfolio-valuation` ships, should it supersede the proxy metric for
   collectors automatically, or should the leaderboard endpoint be explicitly
   updated to use the portfolio-valuation API?
2. Should the `limit` parameter be capped server-side (e.g. max 100)? Current
   proposal: default 50, max 100, enforced via Zod schema.
3. When product defines named seasons (e.g. "Season 4"), should the collectors
   and sellers windows snap to those dates, or remain calendar-year / 90-day?

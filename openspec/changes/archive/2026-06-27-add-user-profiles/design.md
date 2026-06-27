## Context

The `users` table today holds only `stellar_address` and `display_name`. Profile
data (bio, location, website, avatar) never persists between page loads — it
lives in React state initialised from `DEFAULT_PROFILE` in `panels.ts`. Stats
(collection value, cards owned/sold, seller rating, win rate) are literals copied
from that same file. Reviews are a static array. The profile-edit flow writes
only to `TopDeckProvider` in-memory state; a page reload resets everything.

The rest of the stack (trades, listings, offers) already uses Postgres + a
TanStack Query / typed `api` client pattern. Profile merely needs to be wired in
the same way.

## Goals / Non-Goals

**Goals**
- Persist profile fields (bio, location, website, avatar URL, display name) to
  Postgres and expose them via a REST API.
- Derive profile stats from existing `trades` and `listings` rows at read time;
  no materialised stats columns.
- Allow counterparties who have completed a trade to leave a text review with a
  1–5 star rating.
- Unlock achievement badges based on simple thresholds derived from trades/listings
  data at read time.
- Remove all static profile mocks from `panels.ts` and `TopDeckProvider.tsx`.

**Non-Goals**
- Avatar upload (URL field only; file storage is out of scope).
- Notification preferences (the `notifyOutbid` / `notifyEnding` / `notifySales`
  fields in `ProfileData` are left for a future change).
- Pagination on reviews (first pass returns all; volume is low at launch).
- Social graph or follower features.
- Editable achievements; badges are always derived, never stored.

## Decisions

### Decision 1: Extend the `users` table; add a `reviews` table; achievements are derived, not stored

The `users` table gains `bio`, `location`, `website`, `avatar_url` (all nullable
text). A new `reviews` table has `id`, `reviewer_address`, `reviewee_address`,
`rating` (integer 1–5), `text` (nullable), `created_at`; `reviewer_address` and
`reviewee_address` are foreign-key-free text references to stellar addresses to
avoid mandatory `users` rows for both parties.

Achievements are computed in the API handler by running threshold queries against
`trades` and `listings` — no dedicated column or table. At the current user count
this is sub-millisecond; a materialised column can be added later if profiling
warrants it.

- **Why:** Achievements change definition frequently during product iteration;
  storing them means migrations every time a threshold changes. Deriving them at
  query time keeps the schema stable. Alternative — a `user_achievements`
  junction table — was rejected as premature optimisation.

### Decision 2: Profile stats are derived at query time, not materialised

`GET /api/profiles/:address/stats` runs three small aggregates against `trades`
(count where buyer/seller = address, sum of `price_usdc` for "collection value")
and one against `listings`. Seller rating = average review rating. Win rate =
trades where buyer = address divided by total offers the user has made.

- **Why:** The `trades` table is the authoritative source and already indexed by
  `buyer`/`seller`. A materialised `stats` column on `users` would drift out of
  sync without a trigger or indexer hook — two more moving parts for little gain
  at the expected row count (< 10 k trades at launch).

### Decision 3: One review per trade, enforced at the API layer

A reviewer may post at most one review per completed trade (i.e. one where the
reviewer appears as buyer or seller). The API checks for an existing review with
the same `reviewer_address` + `trade_id` before inserting.

- **Why:** Prevents review-bombing. Alternative — one review per (reviewer,
  reviewee) pair — was rejected because a user may legitimately trade with the
  same counterparty multiple times and each experience may differ.

### Decision 4: Authentication relies on the connected wallet address from the request body / query param (same pattern as existing endpoints)

The API does not implement JWT or session auth. The existing endpoints identify
callers by the `stellar_address` they pass. `PUT /api/profiles/:address` trusts
the address in the path; if a proper auth layer is added later the only change
is swapping in a middleware.

- **Why:** Matches the zero-auth pattern of the rest of the API. Security is an
  open question listed below.

### Decision 5: Remove TopDeckProvider profile state entirely; profile pages fetch from the API

The `profile` and `draft` fields are removed from `TopDeckState`. The
`startEditProfile`, `cancelEdit`, `saveProfile`, `setDraft`, and `toggleDraft`
helpers are deleted. The edit page manages its own local form state and calls
`PUT /api/profiles/:address` on submit, then invalidates the profile query.

- **Why:** Keeping both an in-memory draft and a server fetch would produce
  stale-state bugs. React Query's optimistic-update pattern handles pessimistic
  edits without the provider.

## Risks / Trade-offs

- **No write auth** — any caller knowing a stellar address can overwrite that
  user's profile fields. Acceptable for now (all fields are cosmetic); mitigated
  by the fact that the address must be known and no financial data is written
  here. → Mitigation: add a signed-challenge auth middleware as a fast follow.
- **Stats freshness** — stats reflect the Postgres mirror, not the live chain.
  The indexer reconciles within seconds of settlement; lag is acceptable. →
  Mitigation: the existing 5-second refetch interval on the web client means
  stale displays are transient.
- **Win rate definition** — "offers made" is a proxy for "auctions entered"; the
  platform has no pure auction mode yet, so the metric is an approximation. →
  Mitigation: documented in the API response and revisable when auctions ship.

## Migration Plan

1. Add `bio`, `location`, `website`, `avatar_url` columns to `users` (all
   nullable, no default); existing rows get `NULL` — no data loss.
2. Create the `reviews` table.
3. Generate and apply the Drizzle migration (`drizzle-kit generate && push`).
4. Deploy the new API routes; the web changes can ship in the same release.
5. Rollback: the columns are additive and nullable; dropping them is safe.

## Open Questions

- Should `avatar_url` accept any URL or be restricted to a known CDN prefix?
  (Leaning toward any URL for now; content policy can be layered later.)
- Is a 1–5 integer star rating granular enough, or should it be 1–10?
  (Keeping 1–5 to match the existing UI star display.)

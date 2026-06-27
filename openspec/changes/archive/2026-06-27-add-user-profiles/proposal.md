## Why

The profile page today is a fiction: every number, review, and achievement is
hard-coded in `panels.ts`. Users who connect a wallet and make real trades see
the same fake "cardwizard_88" biography and a static ★4.7 rating no matter what
they have actually done on the platform. This change replaces every profile mock
with real persisted data — a bio the user can save, stats derived from live trade
and listing rows, reviews left by real counterparties, and achievement badges
unlocked by on-chain activity.

## What Changes

- **New capability `user-profiles`**: the `users` table gains bio, location,
  website, and avatar columns; a `reviews` table is added for counterparty
  reviews; profile stats (collection value, cards owned/sold, seller rating, win
  rate) are derived from existing `trades` and `listings` rows at query time.
- **Modified capability `marketplace-api`**: new REST endpoints —
  `GET /api/profiles/:address`, `PUT /api/profiles/:address`,
  `GET /api/profiles/:address/stats`, `GET /api/profiles/:address/reviews`,
  `POST /api/profiles/:address/reviews` — are added following the same Express
  Router pattern as `trades.ts` and `catalog.ts`.
- **Modified capability `marketplace-web`**: the profile (`/profile`) and
  profile-edit (`/profile/edit`) pages read from and write to the real API
  instead of the in-memory TopDeckProvider state; the `DEFAULT_PROFILE`,
  `PROFILE_STATS`, `PROFILE_ACHIEVEMENTS`, `PROFILE_ACTIVITY`, and
  `PROFILE_REVIEWS` mocks in `panels.ts` are deleted; `saveProfile` / `draft`
  logic in `TopDeckProvider.tsx` is removed.

## Capabilities

### New Capabilities

- `user-profiles` — persisted user profile (bio, location, website, avatar,
  member-since), stats derived from trade/listing data, counterparty reviews, and
  achievement badges.

### Modified Capabilities

- `marketplace-api` — new profile and reviews endpoints (GET/PUT profile, GET
  stats, GET/POST reviews).
- `marketplace-web` — profile and profile/edit pages read/write the real API;
  static profile panels removed.

## Impact

- **`packages/db/src/schema.ts`** — extend `users` table; add `reviews` table;
  generate Drizzle migration.
- **`apps/api/src/routes/`** — new `profiles.ts` route file; register in the
  Express app.
- **`apps/web/src/lib/api.ts`** and **`queries.ts`** — new typed client methods
  and TanStack Query hooks for profile data.
- **`apps/web/src/app/(marketplace)/profile/page.tsx`** and
  **`profile/edit/page.tsx`** — rewritten to consume real data.
- **`apps/web/src/components/topdeck/panels.ts`** — `DEFAULT_PROFILE`,
  `PROFILE_STATS`, `PROFILE_ACHIEVEMENTS`, `PROFILE_ACTIVITY`, `PROFILE_REVIEWS`
  removed.
- **`apps/web/src/components/topdeck/TopDeckProvider.tsx`** — `profile`,
  `draft`, `saveProfile`, `startEditProfile`, `cancelEdit`, `setDraft`,
  `toggleDraft` state and handlers removed; profile state migrated to server.
- No contract changes; no breaking wire-format changes on existing endpoints.

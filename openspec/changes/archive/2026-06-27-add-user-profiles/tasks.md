## 1. Database — schema & migration

- [x] 1.1 Add `bio`, `location`, `website`, `avatar_url` (all nullable text) columns to the `users` table in `packages/db/src/schema.ts`
- [x] 1.2 Add the `reviews` table to `schema.ts` with columns `id` (uuid pk), `reviewer_address` (text), `reviewee_address` (text), `trade_id` (uuid, nullable fk to trades), `rating` (integer 1–5), `text` (text nullable), `created_at` (timestamp)
- [x] 1.3 Export `ReviewRow` type from `schema.ts`
- [x] 1.4 Generate the Drizzle migration (`drizzle-kit generate`) and apply it (`drizzle-kit push` or add a migration file)

## 2. Shared types

- [x] 2.1 Add `ProfileResponse`, `ProfileUpdateBody`, `ProfileStatsResponse`, `ReviewResponse`, and `ReviewCreateBody` types to `packages/shared/src/index.ts` (or a new `profile.ts` in shared)

## 3. API — profile routes

- [x] 3.1 Create `apps/api/src/routes/profiles.ts` with `GET /api/profiles/:address` — upsert-or-fetch the `users` row and return the profile shape
- [x] 3.2 Add `PUT /api/profiles/:address` to `profiles.ts` — validate body, upsert `users`, return updated profile
- [x] 3.3 Add `GET /api/profiles/:address/stats` to `profiles.ts` — run aggregate queries against `trades`, `listings`, and `reviews`; compute achievements list; return `ProfileStatsResponse`
- [x] 3.4 Add `GET /api/profiles/:address/reviews` to `profiles.ts` — return all reviews for the address ordered by `created_at DESC`
- [x] 3.5 Add `POST /api/profiles/:address/reviews` to `profiles.ts` — validate body, verify counterparty membership in referenced trade, enforce one-review-per-trade, insert row, return `201`
- [x] 3.6 Register `profilesRouter` in `apps/api/src/app.ts` (or equivalent entry file) at `/api/profiles`

## 4. Web — API client & queries

- [x] 4.1 Add `profile(address)`, `updateProfile(address, body)`, `profileStats(address)`, `profileReviews(address)`, and `postReview(address, body)` methods to `apps/web/src/lib/api.ts`
- [x] 4.2 Add `profile`, `profileStats`, `profileReviews` query keys and corresponding `useProfile`, `useProfileStats`, `useProfileReviews` hooks to `apps/web/src/lib/queries.ts`
- [x] 4.3 Add `useUpdateProfile` mutation hook (TanStack Query `useMutation`) that calls `api.updateProfile` and invalidates the profile query on success

## 5. Web — profile page

- [x] 5.1 Rewrite `apps/web/src/app/(marketplace)/profile/page.tsx` to call `useProfile` and `useProfileStats` hooks, removing all imports from `panels.ts`
- [x] 5.2 Render stats section from `ProfileStatsResponse` (collection value, cards owned/sold, seller rating, win rate)
- [x] 5.3 Render achievements grid from `profileStats.achievements` with locked/unlocked state
- [x] 5.4 Render reviews section from `useProfileReviews` (reviewer address, stars, text, relative timestamp)
- [x] 5.5 Show loading skeletons / empty-state copy while queries are pending

## 6. Web — profile-edit page

- [x] 6.1 Rewrite `apps/web/src/app/(marketplace)/profile/edit/page.tsx` to manage local form state for `displayName`, `bio`, `location`, `website`, `avatarUrl`
- [x] 6.2 Pre-populate the form from `useProfile` on mount
- [x] 6.3 On Save, call `useUpdateProfile` mutation; navigate to `/profile` on success; display inline error on failure
- [x] 6.4 On Cancel, navigate to `/profile` without calling the API

## 7. Web — remove TopDeckProvider profile state

- [x] 7.1 Remove `profile`, `draft`, `ProfileData` import from `TopDeckProvider.tsx`; remove `startEditProfile`, `cancelEdit`, `saveProfile`, `setDraft`, `toggleDraft` state and handlers
- [x] 7.2 Remove the `profile` and `draft` fields from `TopDeckState` interface and initial state object

## 8. Remove static profile mocks

- [x] 8.1 Delete `DEFAULT_PROFILE`, `PROFILE_STATS`, `PROFILE_ACHIEVEMENTS`, `PROFILE_ACTIVITY`, and `PROFILE_REVIEWS` exports from `apps/web/src/components/topdeck/panels.ts`
- [x] 8.2 Remove the `ProfileData` interface from `panels.ts` (now lives in shared)
- [x] 8.3 Confirm no remaining imports of the deleted exports across the web app (`grep -r PROFILE_STATS apps/web/src`)

## 9. Tests

- [ ] 9.1 Add API route tests for `GET /api/profiles/:address` (new user, existing user)
- [ ] 9.2 Add API route tests for `PUT /api/profiles/:address` (partial update, full update)
- [ ] 9.3 Add API route tests for `POST /api/profiles/:address/reviews` (happy path, duplicate, non-counterparty, invalid rating)
- [ ] 9.4 Add API route test for `GET /api/profiles/:address/stats` (zero activity, with trades)

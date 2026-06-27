# Tasks — add-marketplace-leaderboard

## 1. Shared types

- [ ] 1.1 Add `LeaderboardBoard` union type (`'collectors' | 'sellers' | 'traders'`) to `packages/shared/src/types.ts`
- [ ] 1.2 Add `LeaderboardRow` interface to `packages/shared/src/types.ts` (fields: `rank`, `stellarAddress`, `collectionValue`, `cardsHeld`, `winRate`, `salesVolume90d`, `salesCount`, `avgRating`, `realizedProfit`, `roi`, `flipCount`)
- [ ] 1.3 Add `LeaderboardOwnStanding` interface to `packages/shared/src/types.ts` (same fields as `LeaderboardRow` plus `rank: number | null`)
- [ ] 1.4 Add `LeaderboardResponse` interface to `packages/shared/src/types.ts` (fields: `board`, `rows`, `ownStanding`, `ratingAvailable`, `cachedAt`)
- [ ] 1.5 Export all new leaderboard types from `packages/shared/src/index.ts`

## 2. Database indexes

- [ ] 2.1 Add a Drizzle migration adding an index on `trades(seller, settled_at)` if not already present
- [ ] 2.2 Add a Drizzle migration adding an index on `trades(buyer, settled_at)` if not already present

## 3. API — leaderboard route

- [ ] 3.1 Create `apps/api/src/routes/leaderboard.ts` exporting a `leaderboardRouter` following the Express Router pattern of `trades.ts`
- [ ] 3.2 Implement a Zod request schema in `leaderboard.ts` validating `board` (enum), `account` (optional string), `limit` (optional int 1–100, default 50)
- [ ] 3.3 Implement in-process cache (`Map<string, { ts: number; rows: LeaderboardRow[] }>`) keyed on `${board}:${limit}` with 5-minute TTL
- [ ] 3.4 Implement the collectors aggregation query: GROUP BY buyer on `trades` filtered to current calendar year; compute holdings proxy value, cards held, and win rate
- [ ] 3.5 Implement the sellers aggregation query: GROUP BY seller on `trades` filtered to `settledAt >= NOW() - INTERVAL '90 days'`; LEFT JOIN `reviews` when available; compute `salesVolume90d`, `salesCount`, `avgRating`
- [ ] 3.6 Add a `reviews` table existence probe (run once at startup, cache result) that sets `ratingAvailable` on sellers responses
- [ ] 3.7 Implement the traders aggregation query: GROUP BY address across buyer and seller sides of `trades` (all time); compute `realizedProfit`, `roi`, `flipCount`
- [ ] 3.8 Implement the `ownStanding` query: a lightweight single-address filter run fresh on every request, not cached, returning the account's rank and metrics for the requested board
- [ ] 3.9 Wire `leaderboardRouter` into `apps/api/src/index.ts` at `GET /api/leaderboard`
- [ ] 3.10 Add `leaderboard` method to `api` client in `apps/web/src/lib/api.ts`: `leaderboard(params: { board: LeaderboardBoard; account?: string; limit?: number }) => Promise<LeaderboardResponse>`

## 4. Web — query hook and page

- [ ] 4.1 Add `queryKeys.leaderboard` key factory to `apps/web/src/lib/queries.ts`
- [ ] 4.2 Add `useLeaderboard(board: LeaderboardBoard, account: string | null)` hook to `apps/web/src/lib/queries.ts` using `api.leaderboard()`; set `staleTime` to 5 minutes to match server-side TTL
- [ ] 4.3 Rewrite `apps/web/src/app/(marketplace)/leaderboard/page.tsx` to import `useLeaderboard` and drive all rendering from `LeaderboardResponse`; remove all imports of `LB_USERS`, `LB_YOU`, `LB_CFGS`, `LB_SUBTITLE` from `panels.ts`
- [ ] 4.4 Render loading skeleton while `useLeaderboard` is fetching
- [ ] 4.5 Render error message and retry affordance when `useLeaderboard` returns an error
- [ ] 4.6 Render `ownStanding` in the "your rank" panel; hide panel (or show connect prompt) when `ownStanding` is `null`
- [ ] 4.7 Render `ratingAvailable: false` state on the sellers tab (show "—" for rating column)

## 5. Tests

- [ ] 5.1 Add a unit test for the collectors aggregation query verifying season window filtering and holdings proxy calculation
- [ ] 5.2 Add a unit test for the sellers aggregation query verifying the 90-day window and graceful null rating when `reviews` is absent
- [ ] 5.3 Add a unit test for the traders aggregation query verifying realized profit calculation and ROI formatting (positive, negative, null for no-buy case)
- [ ] 5.4 Add a route integration test for `GET /api/leaderboard` verifying HTTP 400 on missing `board`, 200 with correct shape on valid requests, and `ownStanding: null` when `account` is omitted
- [ ] 5.5 Add a test verifying the in-process cache serves board rows without re-querying Postgres within the TTL window
- [ ] 5.6 Add a web hook test for `useLeaderboard` verifying it calls `api.leaderboard` with the correct params and re-fetches on board change

## 6. Mock removal

- [ ] 6.1 Delete the `LB_USERS` constant from `apps/web/src/components/topdeck/panels.ts`
- [ ] 6.2 Delete the `LB_YOU` constant from `apps/web/src/components/topdeck/panels.ts`
- [ ] 6.3 Delete the `LB_CFGS` constant from `apps/web/src/components/topdeck/panels.ts`
- [ ] 6.4 Delete the `LB_SUBTITLE` constant from `apps/web/src/components/topdeck/panels.ts`
- [ ] 6.5 Delete the `LbUser` interface from `apps/web/src/components/topdeck/panels.ts` (superseded by `LeaderboardRow` in `@cardmkt/shared`)
- [ ] 6.6 Delete the `LbTab` type from `apps/web/src/components/topdeck/panels.ts` (superseded by `LeaderboardBoard` in `@cardmkt/shared`)
- [ ] 6.7 Verify no remaining imports of the deleted identifiers in the web app (`tsc --noEmit` passes cleanly)

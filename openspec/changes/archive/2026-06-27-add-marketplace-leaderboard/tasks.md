# Tasks — add-marketplace-leaderboard

## 1. Shared types

- [x] 1.1 Add `LeaderboardBoard` union type (`'collectors' | 'sellers' | 'traders'`) to `packages/shared/src/types.ts`
- [x] 1.2 Add `LeaderboardRow` interface to `packages/shared/src/types.ts` (fields: `rank`, `stellarAddress`, `collectionValue`, `cardsHeld`, `winRate`, `salesVolume90d`, `salesCount`, `avgRating`, `realizedProfit`, `roi`, `flipCount`)
- [x] 1.3 Add `LeaderboardOwnStanding` interface to `packages/shared/src/types.ts` (same fields as `LeaderboardRow` plus `rank: number | null`)
- [x] 1.4 Add `LeaderboardResponse` interface to `packages/shared/src/types.ts` (fields: `board`, `rows`, `ownStanding`, `ratingAvailable`, `cachedAt`)
- [x] 1.5 Export all new leaderboard types from `packages/shared/src/index.ts`

## 2. Database indexes

- [x] 2.1 Add a Drizzle migration adding an index on `trades(seller, settled_at)` if not already present
- [x] 2.2 Add a Drizzle migration adding an index on `trades(buyer, settled_at)` if not already present

## 3. API — leaderboard route

- [x] 3.1 Create `apps/api/src/routes/leaderboard.ts` exporting a `leaderboardRouter` following the Express Router pattern of `trades.ts`
- [x] 3.2 Implement a Zod request schema in `leaderboard.ts` validating `board` (enum), `account` (optional string), `limit` (optional int 1–100, default 50)
- [x] 3.3 Implement in-process cache (`Map<string, { ts: number; rows: LeaderboardRow[] }>`) keyed on `${board}:${limit}` with 5-minute TTL
- [x] 3.4 Implement the collectors aggregation query: GROUP BY buyer on `trades` filtered to current calendar year; compute holdings proxy value, cards held, and win rate
- [x] 3.5 Implement the sellers aggregation query: GROUP BY seller on `trades` filtered to `settledAt >= NOW() - INTERVAL '90 days'`; LEFT JOIN `reviews` when available; compute `salesVolume90d`, `salesCount`, `avgRating`
- [x] 3.6 Add a `reviews` table existence probe (run once at startup, cache result) that sets `ratingAvailable` on sellers responses
- [x] 3.7 Implement the traders aggregation query: GROUP BY address across buyer and seller sides of `trades` (all time); compute `realizedProfit`, `roi`, `flipCount`
- [x] 3.8 Implement the `ownStanding` query: a lightweight single-address filter run fresh on every request, not cached, returning the account's rank and metrics for the requested board
- [x] 3.9 Wire `leaderboardRouter` into `apps/api/src/index.ts` at `GET /api/leaderboard`
- [x] 3.10 Add `leaderboard` method to `api` client in `apps/web/src/lib/api.ts`: `leaderboard(params: { board: LeaderboardBoard; account?: string; limit?: number }) => Promise<LeaderboardResponse>`

## 4. Web — query hook and page

- [x] 4.1 Add `queryKeys.leaderboard` key factory to `apps/web/src/lib/queries.ts`
- [x] 4.2 Add `useLeaderboard(board: LeaderboardBoard, account: string | null)` hook to `apps/web/src/lib/queries.ts` using `api.leaderboard()`; set `staleTime` to 5 minutes to match server-side TTL
- [x] 4.3 Rewrite `apps/web/src/app/(marketplace)/leaderboard/page.tsx` to import `useLeaderboard` and drive all rendering from `LeaderboardResponse`; remove all imports of `LB_USERS`, `LB_YOU`, `LB_CFGS`, `LB_SUBTITLE` from `panels.ts`
- [x] 4.4 Render loading skeleton while `useLeaderboard` is fetching
- [x] 4.5 Render error message and retry affordance when `useLeaderboard` returns an error
- [x] 4.6 Render `ownStanding` in the "your rank" panel; hide panel (or show connect prompt) when `ownStanding` is `null`
- [x] 4.7 Render `ratingAvailable: false` state on the sellers tab (show "—" for rating column)

## 5. Tests

- [x] 5.1 Add a unit test for the collectors aggregation query verifying season window filtering and holdings proxy calculation
- [x] 5.2 Add a unit test for the sellers aggregation query verifying the 90-day window and graceful null rating when `reviews` is absent
- [x] 5.3 Add a unit test for the traders aggregation query verifying realized profit calculation and ROI formatting (positive, negative, null for no-buy case)
- [x] 5.4 Add a route integration test for `GET /api/leaderboard` verifying HTTP 400 on missing `board`, 200 with correct shape on valid requests, and `ownStanding: null` when `account` is omitted
- [x] 5.5 Add a test verifying the in-process cache serves board rows without re-querying Postgres within the TTL window
- [x] 5.6 Add a web hook test for `useLeaderboard` verifying it calls `api.leaderboard` with the correct params and re-fetches on board change

## 6. Mock removal

- [x] 6.1 Delete the `LB_USERS` constant from `apps/web/src/components/topdeck/panels.ts`
- [x] 6.2 Delete the `LB_YOU` constant from `apps/web/src/components/topdeck/panels.ts`
- [x] 6.3 Delete the `LB_CFGS` constant from `apps/web/src/components/topdeck/panels.ts`
- [x] 6.4 Delete the `LB_SUBTITLE` constant from `apps/web/src/components/topdeck/panels.ts`
- [x] 6.5 Delete the `LbUser` interface from `apps/web/src/components/topdeck/panels.ts` (superseded by `LeaderboardRow` in `@cardmkt/shared`)
- [x] 6.6 Delete the `LbTab` type from `apps/web/src/components/topdeck/panels.ts` (superseded by `LeaderboardBoard` in `@cardmkt/shared`)
- [x] 6.7 Verify no remaining imports of the deleted identifiers in the web app (`tsc --noEmit` passes cleanly)

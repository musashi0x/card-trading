# Tasks: add-watchlist-persistence

## 1. Database

- [x] 1.1 Add a `watchlist` table to `packages/db/src/schema.ts`: columns `id` (uuid, pk), `account` (text, not null), `listing_id` (uuid, FK → listings.id, not null), `created_at` (timestamptz, defaultNow); add a unique index on `(account, listing_id)`
- [x] 1.2 Generate and apply the Drizzle migration (`pnpm --filter @cardmkt/db db:generate && db:migrate`)

## 2. Shared types

- [x] 2.1 Add a `WatchlistEntry` type to `packages/shared/src/types.ts` (fields: `id`, `account`, `listingId`, `createdAt`, plus joined `listing` and `card` fields matching the GET response shape)

## 3. API — watchlist routes

- [x] 3.1 Create `apps/api/src/routes/watchlist.ts` with an Express Router:
  - `GET /` (`?account=`) — join `watchlist` → `listings` (status = 'open') → `cards`, order by `watchlist.created_at DESC`, return array
  - `POST /` — validate body `{ account, listingId }`, check listing exists (404 if not), insert with `ON CONFLICT DO NOTHING`, return 201/200
  - `DELETE /:listingId` — validate `?account=` query param, delete matching row, return 200
- [x] 3.2 Mount `watchlistRouter` on `/api/watchlist` in `apps/api/src/index.ts`
- [x] 3.3 Extend the indexer in `apps/api/src/indexer.ts`: when marking a listing `sold` or `cancelled`, delete all `watchlist` rows for that `listing_id` in the same DB transaction

## 4. Web — API client

- [x] 4.1 Add watchlist functions to `apps/web/src/lib/api.ts`:
  - `watchlist(account: string)` — GET `/api/watchlist?account=…`
  - `watchlistAdd(account: string, listingId: string)` — POST `/api/watchlist`
  - `watchlistRemove(account: string, listingId: string)` — DELETE `/api/watchlist/:listingId?account=…`

## 5. Web — query hooks

- [x] 5.1 Add `queryKeys.watchlist(account)` to the `queryKeys` map in `apps/web/src/lib/queries.ts`
- [x] 5.2 Add `useWatchlist(account: string | null)` hook (disabled when `account` is null, mirrors `useOrders` pattern)
- [x] 5.3 Add `useToggleWatch` mutation hook with optimistic update: on `mutate`, cache-update `watchlist` query; on `onError`, roll back via `invalidateQueries`

## 6. Web — CardTile

- [x] 6.1 Replace `td.state.watched[c.id]` and `td.toggleWatch(e, c.id)` in `apps/web/src/components/topdeck/shared/CardTile.tsx` with the `useWatchlist` / `useToggleWatch` hooks, keyed by `c.listingId`
- [x] 6.2 When `wallet.address` is null and heart is tapped, call `wallet.connect()` instead of toggling

## 7. Web — My-bids page

- [x] 7.1 Replace `st.cards.filter((c) => st.watched[c.id])` in `apps/web/src/app/(marketplace)/my-bids/page.tsx` with data from `useWatchlist(wallet.address)`
- [x] 7.2 When wallet is not connected, render a connect-prompt in the Watchlist section instead of an empty grid
- [x] 7.3 Update the "Watching" chip count to use `watchlistData.length` from the server query

## 8. Tests

- [ ] 8.1 API route tests for all three watchlist endpoints: happy path, listing-not-found 404, duplicate insert 200, delete non-existent row 200
- [ ] 8.2 Test that indexer closing a listing deletes its watchlist rows

## 9. Remove ephemeral mock logic

- [x] 9.1 Remove `watched: Record<string, boolean>` from `TopDeckState` in `apps/web/src/components/topdeck/TopDeckProvider.tsx`
- [x] 9.2 Remove the `watched: {}` initializer from the `initialState` factory
- [x] 9.3 Remove `toggleWatch: (e: React.MouseEvent, id: string) => void` from the `TopDeckContext` interface
- [x] 9.4 Remove the `toggleWatch` implementation (lines ~466–469) from `TopDeckProvider`
- [x] 9.5 Remove `toggleWatch` from the context value object passed to the provider

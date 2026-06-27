# Proposal: add-watchlist-persistence

## Why

The heart/favorite toggle on every `CardTile` and the "Watchlist" section in the
My-bids page are wired to an ephemeral `watched: Record<string, boolean>` map
inside `TopDeckProvider` React state. The state is lost on every page reload,
cannot be shared across devices, and is invisible to the server — making it
impossible to notify a watcher when a listing's price drops or time is running
out.

Making the watchlist a proper persisted, per-wallet feature is the minimal step
that turns the heart icon into something users can rely on and that we can build
engagement features on top of (notifications, price-drop alerts).

## What Changes

### New

- **`watchlist` DB table** — `(account, listing_id, created_at)` with a unique
  constraint on `(account, listing_id)`. Keyed by listing rather than card because
  the heart appears on listings and a card can be listed multiple times.
- **Watchlist CRUD endpoints** — `GET /api/watchlist?account=…` returns the
  watcher's current watchlist with full listing + card data. `POST /api/watchlist`
  adds an entry. `DELETE /api/watchlist/:listingId` removes it. All three are
  open-auth (wallet address is the identity; no JWT required, matching the existing
  pattern for offers/orders).
- **`useWatchlist` query + `useToggleWatch` mutation** — TanStack Query hooks in
  `apps/web/src/lib/queries.ts` that back the heart toggle with an optimistic
  update so the UI feels instant.

### Modified

- **`TopDeckProvider`** — the local `watched: Record<string, boolean>` state field
  and the `toggleWatch` action are removed. The heart in `CardTile` and the
  Watchlist section in My-bids are driven by the server-backed hook instead.
- **My-bids page** — the Watchlist grid is populated from the persisted query;
  wallet-not-connected state prompts the user to connect rather than silently
  persisting nothing.
- **`marketplace-api`** — gains a new `/api/watchlist` endpoint group.
- **`marketplace-web`** — persisted watchlist state replaces the ephemeral one.

## Capabilities

### New Capabilities

- `watchlist`: per-wallet, server-persisted listing watchlist with optimistic UI.

### Modified Capabilities

- `marketplace-api`: adds watchlist CRUD endpoints keyed by wallet address.
- `marketplace-web`: heart toggle and My-bids Watchlist section use the
  persisted watchlist query; ephemeral local state is removed.

## Impact

- **No breaking changes** to existing on-chain contracts or the settlement flow.
- The `watchlist` table is additive; no existing columns change.
- The local `watched` / `toggleWatch` fields are **REMOVED** from
  `TopDeckProvider` — any code that read `state.watched` or called `toggleWatch`
  will need updating (both call-sites are in this change: `CardTile` and
  `my-bids/page.tsx`).
- Wallets that have not connected will see the heart as inactive; tapping it
  prompts them to connect — this is the first time the app surfaces a
  connect-to-use hint on the card grid.

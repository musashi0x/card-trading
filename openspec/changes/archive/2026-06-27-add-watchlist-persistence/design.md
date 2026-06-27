# Design: add-watchlist-persistence

## Context

`TopDeckProvider` holds a `watched: Record<string, boolean>` map that drives the
heart icon on `CardTile` and the "Watchlist" grid in `my-bids/page.tsx`. It is
toggled via `toggleWatch(e, id)` which does a simple `setState` — nothing is ever
sent to the server. The map is cleared on every full-page reload or new device.

The rest of the stack already demonstrates the pattern this change follows:
`useOrders` / `useListings` are TanStack Query hooks backed by Express endpoints
writing to a Drizzle/Postgres table. The web client never owns persistence —
the server does.

## Goals / Non-Goals

**Goals:**
- Persist the watchlist per wallet address across reloads and devices.
- Keep the heart toggle feeling instant via optimistic UI.
- Handle the not-connected case gracefully (prompt instead of silent no-op).
- Clean up watchlist rows when a listing closes (sold or cancelled).

**Non-Goals:**
- Push notifications or price-drop alerts (future).
- Pagination of the watchlist (a user watching 1000 listings is not a target case).
- On-chain representation of the watchlist.
- Authentication beyond wallet address (matches the existing offer/order pattern).

## Decisions

### Decision 1: Key the table by `listing_id`, not `card_id`

The heart icon lives on individual listings (`CardTile` is given a `TopCard`
which already corresponds to one open listing). A card can be listed multiple
times — if a user watches "Charizard #1 listed for 50 USDC", they are watching
that specific listing at that price. Storing `listing_id` preserves intent and
makes cleanup trivial: when a listing moves to `sold` or `cancelled`, its
watchlist rows can be deleted as part of the same index tick.

**Alternative considered:** `card_id` — simpler across multiple listings of the
same card, but loses the per-price intent and couples the watchlist to a card
the user may no longer care about at a different price. Rejected.

### Decision 2: Optimistic UI for the toggle

The heart flips instantly on click; if the server request fails, TanStack Query
rolls back via `onError` + `invalidateQueries`. This matches the bid/offer UI
pattern and avoids a perceptible lag on each tap.

**Alternative considered:** wait for server round-trip before flipping. Feels
sluggish on mobile; rejected.

### Decision 3: Not-connected case prompts to connect

When `wallet.address` is null and the user taps the heart, the UI calls
`wallet.connect()` rather than silently ignoring the tap. The heart does not
flip until a wallet is connected and the POST succeeds. This is consistent with
how the bid button works.

**Alternative considered:** persist to `localStorage` when disconnected and sync
on connect. Adds complexity for a marginal UX gain; rejected.

### Decision 4: Cleanup when a listing closes

The indexer already updates `listing.status` to `sold` or `cancelled`. As part
of reconciling a closed listing, the indexer will `DELETE FROM watchlist WHERE
listing_id = $1`. This prevents stale rows from accumulating and keeps the My-bids
Watchlist grid free of phantom entries.

**Alternative considered:** leave rows and filter them out in the GET handler by
joining on `listings.status = 'open'`. Works but silently leaks rows; rejected.

### Decision 5: Open-auth endpoints (wallet address in query/body)

`GET /api/watchlist?account=…`, `POST /api/watchlist`, and
`DELETE /api/watchlist/:listingId?account=…` take the wallet address as a
parameter, matching the pattern of `GET /api/orders?account=…`. No JWT or
session is required — the wallet address is not a secret; the worst a malicious
caller can do is read someone's watchlist or add a row under their address
(harmless). Write endpoints validate that the listing exists before inserting.

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Stale watchlist after a listing is cancelled (indexer lag) | Low | Cleanup in indexer tick; GET also joins on `status = 'open'` as a safety net |
| Optimistic update shows heart then rolls back | Low | TanStack `onError` fires `invalidateQueries`; user sees correct state in < 1s |
| Two taps race to toggle — duplicate insert | Low | `UNIQUE (account, listing_id)` + `ON CONFLICT DO NOTHING` on insert |
| Wallet address is not authenticated | Accepted | Matches existing pattern; no sensitive data is protected |

## Migration Plan

1. Add `watchlist` table via a new Drizzle migration (additive, no column changes).
2. Remove `watched` / `toggleWatch` from `TopDeckProvider` (both surfaces updated
   in the same PR; compile errors catch missed call-sites).
3. Deploy API with the new `/api/watchlist` routes before deploying the updated
   web build — the old web code still writes to local state during the window,
   causing no user-visible breakage.

## Open Questions

- Should we add a count of watchers per listing to the catalog API (social proof)?
  Not in scope for this change; can be layered on later.

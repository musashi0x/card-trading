## Context

`GET /api/trades` returns settled trades with price, fee, royalty, seller net, and a Stellar transaction hash. `useTrades()` in `queries.ts` wraps it in a TanStack Query hook. `explorerTx()` in `explorer.ts` converts a hash to a stellar.expert URL. None of these are wired to any page. The "Trade" nav item goes to the barter-trade mock (`/trade`), not a history view; there is no `/trades` route.

## Goals / Non-Goals

**Goals**
- Render the existing real settlement data in a dedicated, linkable page at `/trades`.
- Add a nav entry ("History") so users can reach the page.
- Add optional per-account filtering (`?account=`) at the API and wire a "My trades" toggle in the UI.
- Explorer-link every settlement hash.

**Non-Goals**
- Pagination (the trades table is small in testnet; a simple list is fine for now).
- Card image thumbnails on the history row (listing id → card join would require a new join endpoint; out of scope for this quick-win).
- Offer history, order history (separate concerns).

## Decisions

### Decision 1: Place the view at `/trades`, not inside an existing page

**Chosen:** new route `app/(marketplace)/trades/page.tsx`.

The orders page (`/orders`) is the closest analogue and shows this pattern works well as a standalone page. Embedding history inside the home page would clutter the listing grid. A dedicated route is linkable and mirrors the `/orders` precedent.

**Alternative considered:** inline accordion on the home page. Rejected — hides data and mixes concerns.

### Decision 2: Add `?account=` filter at the API layer (not client-side)

**Chosen:** filter at `GET /api/trades?account=G…` using a Drizzle `or(eq(buyer, account), eq(seller, account))` condition.

Returning the entire trades table and filtering on the client is fine for testnet but does not scale. The API already uses this pattern for orders (`/api/orders?account=`). Two lines of Drizzle change.

**Alternative considered:** client-side filter of the full list. Rejected — inconsistent with orders pattern; grows poorly.

### Decision 3: Reuse `useTrades()` with an optional account parameter

**Chosen:** extend `queryKeys.trades` to accept `account?: string` so the query key includes the filter; extend `useTrades(account?)` to pass it through to `api.trades(account?)`.

This keeps caching correct: global feed and per-wallet feed are distinct cache entries, and invalidating one does not stale the other.

### Decision 4: "History" nav label (not "Trades")

**Chosen:** label the nav item "History".

"Trade" is already taken by the barter-trade mock nav entry. "Trade history" is two words and too wide. "History" is short, unambiguous in context, and matches the user-facing concept of inspecting past settlements.

### Decision 5: Show royalty line even when zero

**Chosen:** always render the royalty column; display "0.0000000" when zero (consistent with `sellerNetUsdc` computation the API already applies). This matches the existing `Verifiable trade history / Primary sale shows no royalty` spec scenario.

## Risks / Trade-offs

- The `Trade` type does not carry card name. Rows will show the listing id (UUID) rather than a card name until a joined endpoint or card-lookup hook is added. Acceptable for a quick-win; the card detail can be added in a follow-on.
- The "History" nav item appears alongside the existing "Trade" (barter) item. If barter trade is removed or renamed in a later change, the nav should be consolidated. Not a blocker.

## Migration Plan

No DB changes. No schema changes. The API change is backward-compatible (optional query param, default returns all). The web route is additive.

## Open Questions

- Should the "History" nav item replace the existing "Trade" (barter) item once `add-card-barter-trade` lands as real? Deferred to that change.
- Should the page auto-refresh on a timer (like listings at 5 s)? Conservative default: no auto-refresh (trades are settled; stale data is unlikely). Can be added trivially if desired.

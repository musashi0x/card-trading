## Why

The settlement contract records every trade — buyer, seller, gross price, platform fee, creator royalty, and an on-chain transaction hash — and the API already exposes this data via `GET /api/trades`. The `useTrades()` TanStack Query hook is wired and typed. Nothing in the UI renders any of it: the trade-history hook is imported nowhere, and no nav entry points to a history view. Users who want to verify a settlement must find the transaction hash themselves on a block explorer. This change surfaces the existing real data in a dedicated page.

## What Changes

- **`apps/web`** — add a `/trades` route under the marketplace group with a trade-history page that calls `useTrades()`, renders each settlement as a row (card name via listing id, buyer, seller, gross price, platform fee, creator royalty, seller net, settle time), and links the settlement hash to the block explorer. Add a "History" nav entry in `TopNav` and `TopDeckProvider`.
- **`apps/api`** — add optional `?account=` filtering to `GET /api/trades` so a connected wallet can scope the list to their own buys and sells. The unfiltered endpoint remains public for a global feed. The web page offers a toggle between "All trades" and "My trades" when a wallet is connected.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `marketplace-web`: a new trade-history view renders `useTrades()` with the full settlement split (price, platform fee, creator royalty, seller net) and explorer links; a "History" nav entry is added; a "My trades" filter scopes to the connected wallet.
- `marketplace-api`: `GET /api/trades` accepts an optional `?account=` query parameter to filter to trades where the given address is the buyer or seller.

## Impact

- **`apps/web/src/app/(marketplace)/trades/page.tsx`** — new file.
- **`apps/web/src/components/topdeck/shell/TopNav.tsx`** — add "History" nav item.
- **`apps/web/src/components/topdeck/TopDeckProvider.tsx`** — add `goTrades` navigation method and expose it on the context.
- **`apps/api/src/routes/trades.ts`** — add `?account=` filter (two `or` conditions on buyer/seller columns).
- **`apps/web/src/lib/queries.ts`** — extend `queryKeys.trades` to accept an optional `account` string; extend `useTrades` to forward it.
- **`apps/web/src/lib/api.ts`** — extend `api.trades()` to accept an optional `account` string.
- No schema changes. No new packages. No breaking changes to existing callers — the filter is additive and optional.

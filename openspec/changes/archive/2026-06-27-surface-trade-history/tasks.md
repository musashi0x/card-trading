## 1. API — account filter

- [x] 1.1 Add optional `?account=` query param to `GET /api/trades`; apply `or(eq(schema.trades.buyer, account), eq(schema.trades.seller, account))` when present (`apps/api/src/routes/trades.ts`)

## 2. Web — query layer

- [x] 2.1 Extend `queryKeys.trades` to accept `account?: string` and include it in the key tuple (`apps/web/src/lib/queries.ts`)
- [x] 2.2 Extend `api.trades(account?)` to append `?account=<encoded>` when provided (`apps/web/src/lib/api.ts`)
- [x] 2.3 Extend `useTrades(account?)` to forward the optional param to `api.trades` and use the updated key (`apps/web/src/lib/queries.ts`)

## 3. Web — navigation

- [x] 3.1 Add `goTrades` navigation method (`router.push('/trades')`) to `TopDeckProvider` and expose it on the context type (`apps/web/src/components/topdeck/TopDeckProvider.tsx`)
- [x] 3.2 Add a "History" nav item to the `navItems` array in `TopNav`, active when `pathname === '/trades'`, using `td.goTrades` (`apps/web/src/components/topdeck/shell/TopNav.tsx`)

## 4. Web — trade history page

- [x] 4.1 Create `apps/web/src/app/(marketplace)/trades/page.tsx` — a `'use client'` page that calls `useTrades(account)` and renders a list of trade rows
- [x] 4.2 Each row SHALL display: buyer (shortened), seller (shortened), gross price, platform fee, creator royalty, seller net, settle time, and an explorer link built with `explorerTx(settleTxHash)`
- [x] 4.3 When a wallet is connected, render a "My trades / All trades" toggle that passes the wallet address to `useTrades` when "My trades" is active
- [x] 4.4 Render an empty-state block (dashed border, centered message) when the list is empty
- [x] 4.5 Render a loading state and an error state consistent with the orders page pattern

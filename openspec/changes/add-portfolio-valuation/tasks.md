## 1. Shared types

- [x] 1.1 Add `PortfolioHolding`, `PortfolioAllocation`, `PortfolioPerformer`, `PortfolioHistoryEntry`, and `PortfolioResponse` TypeScript types to `packages/shared/src/types.ts` and export them from the shared package index

## 2. API — portfolio endpoint

- [x] 2.1 Create `apps/api/src/routes/portfolio.ts` with `GET /` (mounted at `/api/portfolio`): validate `account` query param against the Stellar address pattern (reject with `400 INVALID_ACCOUNT` if invalid); call `filterHeldCards` with all cards from the DB to resolve on-chain holdings; query `trades` joined to `listings` and `cards` to build the per-card valuation waterfall (last trade price → lowest open listing price → zero); query `trades` where `buyer = account` to compute per-card cost basis; compute totals, rarity allocation, best/worst performer, and 12-month history series; return `PortfolioResponse` JSON
- [x] 2.2 Register the portfolio router in `apps/api/src/index.ts` (e.g. `app.use('/api/portfolio', portfolioRouter)`)

## 3. Web lib — API client and query hook

- [ ] 3.1 Add `portfolio: (account: string) => request<PortfolioResponse>('/api/portfolio?account=' + encodeURIComponent(account))` to the `api` object in `apps/web/src/lib/api.ts`; import `PortfolioResponse` from `@cardmkt/shared`
- [ ] 3.2 Add `queryKeys.portfolio` key and `usePortfolio(account: string | null | undefined)` hook to `apps/web/src/lib/queries.ts`; the hook SHALL be disabled (`enabled: !!account`) until a wallet is connected

## 4. Web — portfolio page rewrite

- [ ] 4.1 Rewrite `apps/web/src/app/(marketplace)/portfolio/page.tsx` as a `'use client'` component: read the connected account from `TopDeckProvider`; call `usePortfolio(account)`; render a connect-wallet prompt when no account is connected; render loading skeleton while the query is in-flight; render the full portfolio layout (total value card, value-history bar chart, stat tiles, allocation stacked bar, holdings table) using live data from the API response
- [ ] 4.2 Render an empty-state message ("No cards held") when the holdings array is empty (wallet connected, no holdings); show "—" for holdings with `valuedAt: null` in the value column

## 5. Mock removal

- [ ] 5.1 Remove `PF_RAW`, `PF_HIST_VALS`, `PF_HIST_LABELS`, `ALLOC_COLORS`, and the `PfHolding` interface from `apps/web/src/components/topdeck/panels.ts`; verify no remaining imports of these symbols anywhere in the codebase and delete any now-dead import lines

## 6. Tests

- [ ] 6.1 Write a unit test for the valuation waterfall logic in `portfolio.ts` (last trade price wins over listing price; listing price used when no trades; zero returned when neither exists)
- [ ] 6.2 Write a unit test for the cost-basis lookup (most recent buyer trade used; `costBasisKnown: false` when no trade exists; holdings with unknown cost basis excluded from best/worst)
- [ ] 6.3 Write a unit test for the 12-month history synthesis (months before any purchase return `0`; value uses only data available at month-end; current month matches live total)
- [ ] 6.4 Write a route-level test (supertest or similar) for `GET /api/portfolio` covering: `400 INVALID_ACCOUNT` on a bad address; `200` with empty portfolio for an unknown account; `200` with correct shape for a seeded account with holdings

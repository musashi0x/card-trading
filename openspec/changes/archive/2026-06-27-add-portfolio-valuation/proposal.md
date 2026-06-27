## Why

The portfolio page today is a static fiction: seven hardcoded holdings, a
fabricated value history, and made-up cost numbers. A user who connects a wallet
and navigates to the portfolio sees "Solar Drake · 1st Ed — +36%" regardless of
what they actually own. The data to do this properly already exists — the chain
knows what each wallet holds (`filterHeldCards` in the catalog layer), `trades`
records every purchase with the price paid (cost basis), and open `listings`
provide a market reference price for cards not yet re-traded. This change wires
those three sources together into a live portfolio endpoint and replaces the
static page with a real one.

## What Changes

- A new **portfolio valuation** endpoint (`GET /api/portfolio?account=…`) returns
  the wallet's real card holdings, values each at the most recent trade price for
  that card (or, absent any trade, the cheapest open listing price), computes cost
  basis from the account's own purchase trades, derives unrealized P&L, aggregates
  allocation by rarity, identifies best/worst performers, and produces a 12-month
  value-history time series — all computed on the fly from existing DB tables.
- The **portfolio page** fetches the real endpoint via a new `usePortfolio` query
  hook (disabled until a wallet connects) and renders the same layout sections
  (total value, value history chart, allocation by rarity, stat tiles, holdings
  list) with live data.
- The **four portfolio mocks** — `PF_RAW`, `PF_HIST_VALS`, `PF_HIST_LABELS`,
  `ALLOC_COLORS` — and the `PfHolding` type are removed from `panels.ts`; the
  page no longer imports them.

## Capabilities

### New Capabilities
- `portfolio-valuation`: for a connected wallet, compute and return portfolio
  holdings, per-card valuation, cost basis, total value, unrealized P&L,
  allocation by rarity, best/worst performer, and a monthly value-history series.

### Modified Capabilities
- `marketplace-api`: add `GET /api/portfolio?account=G…|C…`; reuse the
  `filterHeldCards` / catalog layer for holdings resolution.
- `marketplace-web`: portfolio page fetches the real endpoint; `usePortfolio`
  hook added to `queries.ts`; `api.portfolio` added to `api.ts`; mocks removed.

## Impact

- **API** (`apps/api/src/routes/`): new `portfolio.ts` route; registered in
  `apps/api/src/index.ts`.
- **Web lib** (`apps/web/src/lib/api.ts`): add `portfolio` method.
- **Web lib** (`apps/web/src/lib/queries.ts`): add `usePortfolio` hook and
  `queryKeys.portfolio` key.
- **Web page** (`apps/web/src/app/(marketplace)/portfolio/page.tsx`): full
  rewrite to client component that fetches `usePortfolio(account)`.
- **Mock removal** (`apps/web/src/components/topdeck/panels.ts`): delete
  `PF_RAW`, `PF_HIST_VALS`, `PF_HIST_LABELS`, `ALLOC_COLORS`, and `PfHolding`.
- **Shared** (`packages/shared`): add `PortfolioHolding` and `PortfolioResponse`
  types exported from the shared package.
- No DB migrations required: the endpoint is computed from existing `cards`,
  `listings`, and `trades` tables.

## Context

`TopDeckApp.tsx` is a single 2,681-line class component rendering ten "screens" selected by `this.state.screen`. Its parent `TopDeck.tsx` wires up the wallet context and TanStack Query data (listings, cards, orders, disputes) and passes them down as props. `app/page.tsx` renders `<TopDeck />` at `/`, and that is the only route in the App Router.

Navigation handlers (`goHome`, `goMyBids`, `goSell`, `goLeaderboard`, `goPortfolio`, `goTrade`, `goProfile`, `openOrders`, `open`, …) all call `setState({ screen })` plus `window.scrollTo(0, 0)`. Nothing touches the URL, so the address bar never leaves `/`; refresh, deep-linking, and Back/Forward are all broken.

The component's state splits into three tiers:
- **Shared shell**: wallet props, orders query props, search `query`, the 1s `now` clock, `toast`, seed `cards`, top-nav UI (`walletMenuOpen`, `navMenuOpen`, `addressCopied`).
- **Cross-route ephemeral**: optimistic bid maps (`watched`, `status`, `myMax`), the `trade` builder, `profile`/`draft`. These currently survive tab switches because the component never unmounts — under real routing each page mounts/unmounts, so this state would reset unless hoisted.
- **Per-screen local**: browse (`sort`, `facets`, `page`), detail (`selectedId`, `bidOpen`, `bidAmount`, `payAsset`, `quote*`, `pay*`), sell (`sellStep`, `sellMode`, `form`, `mintedCard`, `publishing`, `lastHash`, `dragOver`), my-bids (`myBidsTab`), leaderboard (`lbTab`), orders (`orderBusy`, `ordersArbiter`).

## Goals / Non-Goals

**Goals:**
- Each top-level screen is a real Next.js App Router route with a distinct, deep-linkable, refresh-safe URL.
- Browser Back/Forward and bookmarking work; active nav state is derived from the URL.
- `TopDeckApp.tsx` is decomposed into one component per route plus shared sub-components, each in its own file.
- Screens become function components using hooks, consistent with `TopDeck.tsx`.
- All current behavior is preserved (no feature regressions).

**Non-Goals:**
- No changes to API, smart contracts, data model, or wallet/query logic beyond relocating where it is consumed.
- No visual redesign — markup and styles are ported as-is.
- No new client-side state-management library (use React context + hooks).
- No SSR/server-component data fetching changes; screens remain client components.

## Decisions

### Decision 1: App Router route segments under a shared route group

Map each screen to a route:

| Screen (`state.screen`) | Route | File |
| --- | --- | --- |
| `browse` | `/` | `app/(marketplace)/page.tsx` |
| `detail` | `/card/[id]` | `app/(marketplace)/card/[id]/page.tsx` |
| `mybids` | `/my-bids` | `app/(marketplace)/my-bids/page.tsx` |
| `sell` | `/sell` | `app/(marketplace)/sell/page.tsx` |
| `leaderboard` | `/leaderboard` | `app/(marketplace)/leaderboard/page.tsx` |
| `portfolio` | `/portfolio` | `app/(marketplace)/portfolio/page.tsx` |
| `orders` | `/orders` | `app/(marketplace)/orders/page.tsx` |
| `trade` | `/trade` | `app/(marketplace)/trade/page.tsx` |
| `profile` | `/profile` | `app/(marketplace)/profile/page.tsx` |
| `editprofile` | `/profile/edit` | `app/(marketplace)/profile/edit/page.tsx` |

A route group `(marketplace)` holds a shared `layout.tsx` (the top nav, search, wallet menu, toast host, and the shared provider) so every route renders inside the same shell without re-declaring it. The group keeps the URL clean (no `/marketplace` prefix).

**Alternatives considered:** Parallel/intercepting routes for the card detail modal — rejected as over-engineering; detail is a full screen today. A single catch-all route reading a query param — rejected because it doesn't give clean, semantic paths and keeps the monolith.

### Decision 2: A `TopDeckProvider` context replaces `TopDeck.tsx`'s prop drilling

Move the wallet/query wiring from `TopDeck.tsx` into a client provider mounted in the route-group layout. It exposes (via a `useTopDeck()` hook): wallet actions, orders/disputes query results + mutations, seed/live `cards`, `catalog`, explorer helpers, the search `query` + setter, the shared `now` clock, a `toast()` helper, and the **cross-route ephemeral state** (`watched`/`status`/`myMax` bid maps, `trade` builder, `profile`/`draft`). Per-screen-local state stays in each page via `useState`.

**Rationale:** Cross-route state must outlive individual route mounts; context is the lightest way to share it. Wallet/query consumers are now plain function components, so they can call the existing hooks (`useWallet`, `useOrders`, …) directly — but centralizing in one provider avoids duplicate query subscriptions and keeps the layout thin.

**Alternative considered:** Let each page call the query/wallet hooks independently. Rejected — duplicates the orders mutation wiring and loses the shared ephemeral state.

### Decision 3: URL-driven navigation and active state

Replace `goX`/`open` handlers with `next/link` (`<Link>`) for nav items and `useRouter().push()` for programmatic transitions (e.g. after a successful sell → push `/my-bids`). Active-tab highlighting derives from `usePathname()` instead of comparing `state.screen`. The card detail opens via `/card/[id]`, reading `id` from `useParams()`; an unknown/closed listing renders a not-found state. The `window.scrollTo(0, 0)` on every navigation becomes a small effect keyed on `pathname` in the layout.

### Decision 4: Shared sub-component extraction

Pull reusable building blocks out of the class into their own files so route components stay small: top nav + mobile nav dropdown, wallet menu/chip, search box, card grid + card tile, filter sidebar, bid panel, toast. These live under `apps/web/src/components/topdeck/` (e.g. a `shell/` and `shared/` grouping). Existing `lib.ts` / `panels.ts` helpers are reused unchanged.

### Decision 5: Phased, route-by-route migration

Build the provider + layout + shared sub-components first, then port one route at a time, deleting the corresponding branch from the class component as each route goes live and is verified. The class component remains renderable until the last screen is ported, then `TopDeckApp.tsx` and the old `TopDeck.tsx` render path are removed. This keeps every intermediate commit shippable.

## Risks / Trade-offs

- **Cross-route state reset** (bid maps, trade builder, profile draft would clear on navigation once screens unmount) → Hoist this state into `TopDeckProvider` (Decision 2) so it persists across route changes within a session.
- **Behavioral regressions from a large mechanical refactor** → Port route-by-route (Decision 5) and verify each route in the browser preview before deleting its class branch.
- **Client-component boundaries** (App Router defaults to server components; this UI is fully client-side) → Mark the route-group layout and every route `'use client'`; data still flows through the existing client query hooks.
- **Detail route for a stale/expired listing id** (previously impossible since `selectedId` was always set internally) → Render an explicit "listing not found / ended" state on `/card/[id]` when the id isn't in the current listings.
- **`now` clock churn** (a 1s tick in a shared provider re-renders all routes) → Keep the tick in the provider but expose `now` narrowly; the original already paused the tick during bid/sell — preserve that gating.

## Migration Plan

1. Scaffold `app/(marketplace)/layout.tsx` + `TopDeckProvider`; move wallet/query wiring out of `TopDeck.tsx`.
2. Extract shared sub-components (nav, wallet menu, search, card grid, filters, bid panel, toast).
3. Port routes incrementally: `/` (browse) → `/card/[id]` → `/my-bids` → `/sell` → `/leaderboard` → `/portfolio` → `/orders` → `/trade` → `/profile` + `/profile/edit`. Verify each in preview; delete its class branch as it lands.
4. Remove `TopDeckApp.tsx` and the legacy render path once all routes are live.

**Rollback:** Frontend-only and phased — revert the route-group commit(s) to restore the single-page class component; no data migration is involved.

## Open Questions

- Should browse filters/sort/page be encoded in the URL as query params (e.g. `/?q=&sort=&page=`) for shareability, or kept as local state? Default: keep `query` URL-synced (it's in the shared nav) and leave sort/facets/page local for now.
- Is `profile` data still static design data, or will it become wallet-derived? If it stays static, the `profile`/`draft` ephemeral state can remain in the provider unchanged.

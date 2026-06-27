## Why

The entire TopDeck marketplace UI lives in a single 2,681-line class component (`TopDeckApp.tsx`) where every "page" is just internal React state (`this.state.screen`). Clicking a nav tab calls `setState({ screen })` and never touches the URL, so the address bar is stuck on `/` no matter which tab is open — links can't be shared or bookmarked, the browser Back/Forward buttons don't work, and a refresh always drops the user back on the home/browse screen. The monolithic file is also hard to navigate, review, and extend.

## What Changes

- Introduce **real URL-based routing** using the Next.js App Router: each in-state `screen` becomes its own route segment so the URL reflects the current page and is deep-linkable, refresh-safe, and Back/Forward aware.
  - `/` → browse/auctions, `/card/[id]` → card detail, `/my-bids`, `/sell`, `/leaderboard`, `/portfolio`, `/orders`, `/trade`, `/profile`, `/profile/edit`.
- **Decompose `TopDeckApp.tsx`** (2,681 lines) into one component per page plus shared building blocks (top nav, wallet menu, card grid, etc.), each in its own file.
- **Convert the class component to function components + hooks**, matching the hook-based style already used in `TopDeck.tsx` and the rest of the app.
- **Hoist shared concerns into a route-group layout / provider**: the sticky top nav, wallet context wiring, search query, react-query data feeds, and the live `now` clock move to a shared layout so every route renders inside the same shell without duplicating logic.
- Preserve all existing behavior — wallet flows, bidding, selling/minting, escrow orders, disputes, leaderboard, portfolio, trade, profile editing, pay-with-any-asset — while it moves behind real routes.
- **BREAKING** (internal only): `TopDeckApp` as a single rendered class component is removed; `app/page.tsx` no longer renders the whole app. No change to the public marketplace feature set.

## Capabilities

### New Capabilities
- `web-navigation`: URL-driven navigation for the marketplace web app — each top-level screen is addressable by a distinct route, with deep-linking, refresh persistence, browser Back/Forward support, and active-tab state derived from the current URL.

### Modified Capabilities
<!-- No existing spec requirements change; marketplace-web feature behaviors are preserved as-is and merely move behind routes. -->

## Impact

- **Affected code**:
  - `apps/web/src/app/` — new route segments/folders (`card/[id]`, `my-bids`, `sell`, `leaderboard`, `portfolio`, `orders`, `trade`, `profile`, `profile/edit`) and a shared route-group `layout.tsx`.
  - `apps/web/src/app/page.tsx` — becomes the browse/auctions route instead of rendering the whole app.
  - `apps/web/src/components/topdeck/TopDeckApp.tsx` — removed/decomposed into per-page components and shared sub-components under `apps/web/src/components/topdeck/`.
  - `apps/web/src/components/topdeck/TopDeck.tsx` — data/wallet wiring moves into a shared layout/provider so it can be consumed across routes.
- **Dependencies**: Next.js App Router routing (`next/navigation` — `useRouter`, `usePathname`, `useParams`, `Link`). No new packages expected.
- **Systems**: Frontend only. No API, smart-contract, or data-model changes.

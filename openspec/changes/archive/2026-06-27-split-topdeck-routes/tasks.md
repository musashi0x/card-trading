## 1. Shared shell & provider

- [x] 1.1 Create `app/(marketplace)/layout.tsx` (client) hosting the route-group shell: top nav, search box, wallet menu/chip, mobile nav dropdown, and toast host.
- [x] 1.2 Create `TopDeckProvider` + `useTopDeck()` hook that wires the wallet context, orders/disputes queries + mutations, live `cards`/`catalog`, explorer helpers, and the shared `now` clock (preserving the original tick gating).
- [x] 1.3 Hoist cross-route ephemeral state into the provider: search `query`, optimistic bid maps (`watched`/`status`/`myMax`), the `trade` builder, `profile`/`draft`, and a `toast()` helper.
- [x] 1.4 Add a `pathname`-keyed effect in the layout that scrolls to top on navigation (replacing the per-handler `window.scrollTo(0,0)`).
- [x] 1.5 Mount the provider in the layout and confirm `useTopDeck()` is consumable from a placeholder route.

## 2. Shared sub-components

- [x] 2.1 Extract the top nav + mobile nav dropdown into their own files, with `<Link>`-based items and active state derived from `usePathname()`.
- [x] 2.2 Extract the wallet menu/chip (connect, copy, explorer, disconnect) into its own component consuming `useTopDeck()`.
- [x] 2.3 Extract the search box and wire it to the provider's `query`.
- [x] 2.4 Extract the card grid + card tile (opening a card navigates to `/card/[id]`).
- [x] 2.5 Extract the filter sidebar, bid panel, and toast into their own files.

## 3. Route migration (one per screen)

- [x] 3.1 Port browse to `app/(marketplace)/page.tsx` (`/`) with local `sort`/`facets`/`page` state and URL-synced search `query`.
- [x] 3.2 Port card detail to `app/(marketplace)/card/[id]/page.tsx`, reading `id` via `useParams()` and rendering a not-found/ended state for unavailable listings.
- [x] 3.3 Port my-bids to `app/(marketplace)/my-bids/page.tsx` (with the bidding/selling sub-tabs).
- [x] 3.4 Port sell to `app/(marketplace)/sell/page.tsx` (multi-step form, hold/mint modes, image upload); on publish, `router.push('/my-bids')`.
- [x] 3.5 Port leaderboard to `app/(marketplace)/leaderboard/page.tsx` (collectors/sellers/traders tabs).
- [x] 3.6 Port portfolio to `app/(marketplace)/portfolio/page.tsx`.
- [x] 3.7 Port orders to `app/(marketplace)/orders/page.tsx` (buyer/seller + arbiter disputes view).
- [x] 3.8 Port trade to `app/(marketplace)/trade/page.tsx` (builder + sent state).
- [x] 3.9 Port profile to `app/(marketplace)/profile/page.tsx` and edit to `app/(marketplace)/profile/edit/page.tsx` (cancel/save navigate between the two).
- [x] 3.10 Mark each route `'use client'` and delete its corresponding branch from the class component as it goes live.

## 4. Cleanup & teardown

- [x] 4.1 Repoint or remove the old `app/page.tsx` → `TopDeck` render path (browse now lives in the route group).
- [x] 4.2 Delete `TopDeckApp.tsx` and any now-unused wiring in `TopDeck.tsx` once all routes are live.
- [x] 4.3 Remove dead state/handlers and confirm `lib.ts` / `panels.ts` helpers are still imported correctly.

## 5. Verification

- [x] 5.1 Verify each route in the browser preview: direct load/refresh renders the right screen (no redirect to home).
- [x] 5.2 Verify Back/Forward navigation moves between screens and the active nav item matches the URL.
- [x] 5.3 Verify session state persists across navigation: wallet stays connected, unsent trade builder and unsaved profile draft survive route changes.
- [x] 5.4 Verify `/card/[id]` for a stale/unknown id shows the not-found/ended state.
- [x] 5.5 Run typecheck/lint/build for `apps/web` and fix any fallout.

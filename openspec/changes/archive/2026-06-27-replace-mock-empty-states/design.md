## Context

`TopDeckProvider` (outer provider in `apps/web/src/components/topdeck/TopDeckProvider.tsx`)
runs `useListings()` and maps the result into a `seed` memo typed as
`TopCard[] | null`. The current logic:

```
if (listingsPending)           → null          (Splash is rendered)
if (listingsError || !listings) → mockCards()  (8 fake lots)
if (mapped.length === 0)       → mockCards()   (8 fake lots)
else                           → mapped
```

`if (!seed) return <Splash />` then gates the entire marketplace tree on that
value. The browse grid in `apps/web/src/app/(marketplace)/page.tsx` only ever
receives a non-null, non-empty list (because the fallback fills it), so it has
no empty-state path for "API returned nothing" — only for "your filter matched
nothing".

`mockCards()` in `lib.ts` (line ~185) constructs 8 hardcoded `TopCard` objects
with fabricated ids, prices, seller names, and bid histories. They are
unactionable: users cannot buy them, sellers do not exist, and they disappear
silently the moment the API does respond.

## Goals / Non-Goals

**Goals:**
- Remove `mockCards()` entirely so fabricated data can never leak into the UI.
- Expose three honest states from `TopDeckProvider` to the browse grid:
  1. **loading** — fetch in flight (Splash, existing behavior, updated copy).
  2. **error** — API failure (distinct error panel with a Retry button).
  3. **empty** — API success, zero open listings (honest empty state).
- Keep the change strictly to UI layer (no contract, DB, or API changes).

**Non-Goals:**
- Redesigning the Splash component beyond a copy tweak.
- Removing other mock data (leaderboard, portfolio, profile, trade, watchlist —
  those are owned by their respective changes per the brief).
- Implementing any auction or bidding behavior (owned by `add-onchain-auctions`).

## Decisions

### Decision 1: Expose `listingsError` and `listingsPending` on the TopDeck context rather than passing them through `seedCards`

The `TopDeckStore` inner component receives `seedCards: TopCard[]` today. To
surface error/empty states downstream we have two options:

**A. Widen `seedCards` to a discriminated union** — `{ status: 'loading' | 'error' | 'empty' | 'ok'; cards: TopCard[] }` — and pass it to `TopDeckStore`.

**B. Lift the error/empty rendering above `TopDeckStore`** — instead of
mounting `TopDeckStore` at all when there is an API error or the list is empty,
render a dedicated panel at the `TopDeckProvider` level (the same level as `Splash`).

Option B keeps `TopDeckStore` / `seedCards` unchanged (no internal type widening),
is the smallest possible diff, and avoids threading new props through the entire
context. The browse grid at `apps/web/src/app/(marketplace)/page.tsx` still
receives real `TopCard[]` when mounted. **Option B is chosen.**

### Decision 2: The error panel carries a Retry button wired to `queryClient.invalidateQueries`

The `useListings` hook is a TanStack Query query. The cleanest retry is
`queryClient.invalidateQueries({ queryKey: ['listings'] })`, which is already
available inside `TopDeckProvider` (it has `useQueryClient()`). The error panel
renders inside `TopDeckProvider` before `TopDeckStore` is mounted, so it calls
`invalidateQueries` directly without needing a context callback.

### Decision 3: The empty state renders inside the browse grid, not at the provider level

When the API returns successfully with zero listings, `TopDeckProvider` passes
`seedCards={[]}` to `TopDeckStore`. The browse grid in `page.tsx` is already
responsible for the "no filter matches" empty state. Extending it to handle "no
listings at all" (when `!query && fc.cats.length === 0 && fc.rarities.length === 0`
and `list.length === 0`) keeps the rendering concern in the right component and
avoids a new provider-level render path for an expected runtime state.

## Risks / Trade-offs

- **Brief empty marketplace**: on initial deployment, or after all listings
  settle/expire, real users will see the empty state. This is the correct and
  honest behavior. A CTA to "list a card" softens the experience.
- **Dependency ordering**: `add-onchain-auctions` also edits `lib.ts` and
  `TopDeckProvider.tsx`. When composing both changes, the `mockCards` deletion
  in this change can conflict if applied before auction fields are removed. In
  practice both changes reduce rather than add code; merge order does not matter
  as long as both are eventually applied.

## Migration Plan

1. Remove `mockCards()` from `lib.ts` and its import/calls in `TopDeckProvider.tsx`.
2. Update the `seed` memo: `null` on loading, `'error'` sentinel on error, `TopCard[]` (possibly empty) on success.
3. Add `ErrorPanel` and update `Splash` copy in `TopDeckProvider`.
4. Update the browse grid in `page.tsx` to render a "no open listings" empty state when `list.length === 0` and no filters are active.

## Open Questions

- None — this is a narrow cleanup with clear implementation boundaries.

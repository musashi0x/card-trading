## Why

Today, when the listings API is unreachable or returns zero open listings,
`TopDeckProvider` silently falls back to `mockCards()` — 8 hardcoded demo lots
— and renders them as if they were real marketplace data. A visitor sees cards
with fake names, prices, and sellers that cannot be purchased, without any
indication that something went wrong. This is a **silent-failure / fake-data**
problem: real errors are hidden, and users have no way to distinguish live
inventory from fabricated placeholders.

Honest UI is a prerequisite for a trustworthy marketplace. The first step is to
remove the fabricated fallback and replace it with three clearly distinct states
that reflect what is actually happening.

## What Changes

- **Loading state**: while the listings fetch is in flight, `TopDeckProvider`
  already shows a `Splash` screen. This state is kept, but the copy is updated
  to be neutral ("Loading marketplace…") rather than implying auctions are
  always present.
- **Empty state**: when the API succeeds but returns zero open listings, the
  browse grid shows an honest "No open listings yet" empty state with a brief
  call-to-action to list a card — no fabricated cards.
- **Error state**: when the API is unreachable or returns an error, the browse
  grid shows a distinct error state with a "Retry" button that re-triggers the
  `useListings` query — no fabricated cards.
- **`mockCards()` removed**: the function and all its call sites in
  `TopDeckProvider.tsx` are deleted. The `seed` memo no longer falls back to
  fake data; it exposes a tri-state (loading / error / empty-or-populated) that
  the browse grid renders honestly.

## Capabilities

### Modified Capabilities

- **marketplace-web**: `TopDeckProvider` seed memo and browse grid updated to
  render loading, empty, and error states instead of fabricated listings.
  `mockCards()` deleted from `lib.ts`. The `Splash` component remains for the
  loading path but its copy no longer references auctions.

## Impact

- **Users**: users see truthful UI at all times; errors are surfaced and
  retryable rather than silently masked.
- **Developers**: `mockCards()` is gone; the function cannot be accidentally
  re-introduced as a fallback.
- **No breaking contract, API, or DB changes.** This is a pure UI cleanup.
- **Depends on `add-onchain-auctions`** in so far as that change also modifies
  `lib.ts` and `TopDeckProvider.tsx`; the auction work removes bid simulation
  fields, this change removes the `mockCards` fallback. Both can be applied
  independently and composed.

## 1. TopDeckProvider — honest tri-state seed

- [x] 1.1 Update the `seed` useMemo in `TopDeckProvider` to return `null` while loading, `'error'` (string sentinel) on API failure, and `TopCard[]` (possibly empty array) on success — removing all `mockCards()` calls
- [x] 1.2 Add an `ErrorPanel` component inside `TopDeckProvider.tsx` that displays a brief error message and a Retry button wired to `queryClient.invalidateQueries({ queryKey: ['listings'] })`
- [x] 1.3 Update the `Splash` component copy from "Loading live auctions…" to neutral copy (e.g. "Loading marketplace…") so it no longer implies auctions are always present
- [x] 1.4 Update the `TopDeckProvider` render gate: `if (!seed) return <Splash />`, `if (seed === 'error') return <ErrorPanel />`, else mount `<TopDeckStore seedCards={seed} …>`

## 2. Browse grid — empty and error states

- [x] 2.1 In `apps/web/src/app/(marketplace)/page.tsx`, detect the "no listings, no active filters" case (`list.length === 0 && !query && fc.cats.length === 0 && fc.rarities.length === 0`) and render an honest empty state: "No open listings yet" with a CTA to list a card
- [x] 2.2 Ensure the existing "no filter matches" empty state (SearchOffIcon panel) is preserved and only shown when filters/search are active

## 3. Remove mockCards

- [x] 3.1 Delete the `mockCards()` function from `apps/web/src/components/topdeck/lib.ts`
- [x] 3.2 Remove the `mockCards` import from `apps/web/src/components/topdeck/TopDeckProvider.tsx`
- [x] 3.3 Verify no other file in the repository imports or calls `mockCards`

## Why

The marquee **"Buy now · $X"** button on the card detail page does not settle a purchase on a classic wallet (Albedo/Freighter). The existing specs already require it to (`marketplace-web` → "Accept an offer and buy now", "Pay for a card with any held asset"; `pay-with-any-asset` → "Convert any held asset…"), but the implementation drifted away from them during the mock-data removal:

- **USDC payer (`TopDeckProvider.tsx:634`)** — clicking Buy sets state to `won` and shows "Purchased! 🎉" with **no API call and no transaction**. Nothing moves on-chain; the seller is never paid and the card never transfers.
- **Non-USDC payer (`TopDeckProvider.tsx:644`)** — `payWithAsset` (`WalletProvider.tsx:341`) submits **only** the path-payment top-up, converting the buyer's XLM into USDC **in the buyer's own wallet**, then fakes `won`. The `buy_now` settlement is **never** called. The buyer spends real XLM (plus conversion spread and slippage), receives no card, and the seller gets nothing.

The backend is complete and orphaned: `POST /api/tx/buy-now` (`build.ts:170`), the Soroban `buy_now` (`lib.rs:508`), `reconcile`, `markSold`, and `recordTrade` all work. The `runAction('buy_now', …)` helper that would drive them exists but is wired for every trade action **except** `buy_now`.

Fixing the wiring exposes a second, genuinely new gap the specs do not yet cover: the pay-with-any-asset flow is two non-atomic transactions (conversion, then settlement). Once the settle leg is real, a buyer can confirm the conversion and then have `buy_now` fail (listing sniped → `NotOpen`, `SelfTrade`, trustline race, network), leaving them holding USDC with no card and no recovery path.

## What Changes

- **Wire the classic-wallet digital buy-now path** so both the USDC and non-USDC branches build, sign, and submit a real `buy_now` settlement via `runAction('buy_now', …)`, and only show "it's yours" after the settlement transaction confirms.
- **Make `payWithAsset` settle after it converts**: on confirmation of the path payment, proceed to the `buy_now` settlement step (per the existing `pay-with-any-asset` spec) instead of returning early.
- **Add stranded-buyer safeguards** for the non-atomic conversion→settlement seam: re-check the listing is still open immediately before conversion, and on a post-conversion settlement failure surface the residual USDC and a retry path instead of a silent loss.
- **Add an API status precheck** to `POST /api/tx/buy-now` so a closed/sold listing returns a clean `LISTING_CLOSED` error instead of building a doomed transaction the buyer signs and pays for.
- **Close the orphaned-escrow-order gap** revealed alongside this work: the `purchase-escrow` build pre-inserts a `funded` order row before the tx confirms (`build.ts:207`); abandoned signs leave permanent orphan rows with `contractOrderId = null`.

## Capabilities

### Modified Capabilities

- `marketplace-web`: The classic-wallet buy-now button must submit a real settlement (no fake "won" state), and the pay-with-any-asset UI must communicate residual USDC and a retry path when settlement fails after conversion.
- `pay-with-any-asset`: Add graceful recovery when settlement fails after the conversion has already committed, and a listing-still-open recheck before the conversion.
- `marketplace-api`: `POST /api/tx/buy-now` rejects a closed listing before building; escrow order rows are not orphaned by abandoned signatures.

## Impact

- **Frontend**: `apps/web/src/components/topdeck/TopDeckProvider.tsx` (`buyNow`), `apps/web/src/components/WalletProvider.tsx` (`payWithAsset`), and `apps/web/src/app/(marketplace)/card/[id]/page.tsx` (residual/retry UI).
- **API**: `apps/api/src/routes/tx/build.ts` (buy-now status precheck; escrow order pre-insert), `apps/api/src/data/listings.ts` (open-listing read/guard helper).
- **Database**: No schema changes. Optionally a sweep/TTL for abandoned `funded` orders with `contractOrderId = null`.
- **Contracts**: None — the Soroban `buy_now` is unchanged; atomicity of the conversion+settlement pair is handled off-chain per the existing `pay-with-any-asset` design.
- **Risk**: This is primarily a conformance fix bringing code back in line with already-approved specs. The marquee purchase path goes from non-functional/loss-inducing to working; no breaking changes to working paths (passkey Face ID, physical escrow).

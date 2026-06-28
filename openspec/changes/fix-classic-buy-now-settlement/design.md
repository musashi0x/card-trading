## Context

The buy feature has three user-facing purchase paths on the card detail page (`apps/web/src/app/(marketplace)/card/[id]/page.tsx`):

| Path | Trigger | Status today |
|---|---|---|
| Face ID (passkey smart wallet) | `payWithPasskey` → `passkeyBuyNow` → `/api/tx/passkey-submit` (`action: 'buy_now'`) | ✅ Real, settles on-chain |
| Physical escrow | `escrowBuy` → `escrowPurchase` → `/api/tx/purchase-escrow` | ✅ Real, settles on-chain |
| Classic-wallet digital buy now | `buyNow` (`TopDeckProvider.tsx:621`) | ❌ Fake (USDC) / broken (non-USDC) |

The classic path is the only one that does not call the (fully implemented) backend. The Soroban contract is the source of truth and is correct:

```rust
// lib.rs:508
pub fn buy_now(env, buyer, listing_id) {
    if listing.status != STATUS_OPEN { panic NotOpen }       // double-settle impossible
    if listing.fulfillment != FULFILL_DIGITAL { panic WrongFulfillment }
    if listing.seller == buyer { panic SelfTrade }
    // atomic: USDC → seller / platform / creator, card → buyer
    listing.status = STATUS_DONE                              // flips in the same tx
}
```

Because `reconcile()` only runs after a confirmed tx, and the chain guard makes a second `buy_now` panic, there is **no** card double-settle and **no** DB-marked-sold-without-chain risk. The genuine risk lives entirely in the off-chain two-transaction sequence of pay-with-any-asset.

## Goals / Non-Goals

**Goals:**
- Make the classic-wallet digital buy-now button actually settle (USDC and non-USDC branches), reusing the existing `runAction('buy_now', …)` → `/api/tx/buy-now` → `/api/tx/submit` → `reconcile` pipeline.
- Only show success state after the settlement transaction confirms.
- Add safeguards so a buyer who has already committed the irreversible conversion is never left with a silent loss when settlement fails.
- Reject a closed listing at build time with a machine-readable error.
- Stop orphaning escrow order rows on abandoned signatures.

**Non-Goals:**
- Making conversion + settlement atomic in a single transaction. The `pay-with-any-asset` spec deliberately keeps the contract USDC-only and the conversion separate; changing that is out of scope.
- Any change to the Soroban contract.
- Any change to the working passkey (Face ID) or physical-escrow paths.
- A full background reconciliation/retry service (a minimal abandoned-order sweep is in scope; a general retry engine is not).

## Decisions

### 1. Reuse `runAction('buy_now', …)` rather than a bespoke buy handler
**Decision**: `buyNow()` calls `wallet.runAction('buy_now', { listingId, buyer })` exactly as the auction/list flows call `runAction` today.
**Rationale**: The build→sign→submit→reconcile pipeline already exists, is used by `place_bid`, `settle_auction`, `cancel_auction`, `create_auction`, and `list`, and is the path the spec describes. Adding a parallel path would duplicate signing/error logic.
**Alternative considered**: A new `digitalBuyNow` method in WalletProvider. Rejected — `runAction` already does precisely this.

### 2. `payWithAsset` returns control to the buy flow, which then settles
**Decision**: `payWithAsset` keeps its single responsibility (convert), and `buyNow()` calls `runAction('buy_now', …)` after `payWithAsset` resolves. The success toast/state moves to after settlement confirms, not after conversion.
**Rationale**: Matches the spec's "convert then settle" sequencing and keeps the residual-handling logic (decision 3) in one place — the caller that knows both legs.
**Alternative considered**: Have `payWithAsset` itself chain into `buy_now`. Rejected — it would couple conversion to settlement and obscure which leg failed.

### 3. Stranded-buyer recovery: recheck before, surface residual after
**Decision**:
- **Before conversion**: re-fetch the listing and confirm `status === 'open'` (and not the buyer's own). If closed, abort before spending anything and tell the buyer the card is no longer available.
- **After a failed settlement**: do not show success. Surface that the buyer now holds the converted USDC and offer a retry of `buy_now` (or a clear message that they hold $X USDC and can buy another card), distinguishing `NotOpen`/`SelfTrade` (terminal for this listing) from transient errors (retryable).
**Rationale**: The conversion is irreversible; the recheck shrinks the race window cheaply and the residual messaging turns a silent loss into an understood, recoverable state. Full atomicity is impossible without contract changes the spec forbids.
**Alternative considered**: Auto-refund the USDC back to the source asset. Rejected — a second conversion incurs more spread/slippage and can also fail; leaving the buyer holding USDC they can spend is strictly better.

### 4. Quote delivers exactly the settlement USDC
**Decision**: Keep the strict-receive quote targeting exactly `listing.priceUsdc` (already the case). This bounds the residual to the slippage cap and makes "you hold $X USDC, retry" a tight, truthful statement.

### 5. API rejects a closed listing before building
**Decision**: `POST /api/tx/buy-now` checks `listing.status === 'open'` (via a read helper in `data/listings.ts`) and returns `LISTING_CLOSED` (PreflightError) before calling `contract.buyNow`. The chain remains the authority; this is a UX/cost guard, not the correctness gate.
**Rationale**: Prevents the buyer from signing and broadcasting a transaction that the chain will panic on, avoiding a wasted signature and (for the non-passkey path) any fee.

### 6. Escrow order rows are not orphaned
**Decision**: Prefer inserting the `orders` row during `reconcile` (after the escrow tx confirms) rather than at build time; if a build-time id is required by the current XDR shape, add a sweep that deletes `funded` orders with `contractOrderId = null` older than a short TTL.
**Rationale**: Today an abandoned signature leaves a permanent `funded` row with no on-chain counterpart, which pollutes the buyer's order list and can block re-purchase. This is adjacent to the buy fix and cheap to close while the code is open.

## Risks / Trade-offs

- **Residual window remains non-zero.** The recheck shrinks but cannot eliminate the race between conversion confirming and `buy_now` landing. Accepted: bounded by the slippage-capped residual and clear retry UX; eliminating it requires contract changes the spec forbids.
- **Moving the escrow insert to reconcile** changes where `refId` originates for the escrow build; needs care so the submit→reconcile correlation still works. Mitigated by the sweep fallback if the insert can't move.

## Open Questions

- Should a post-conversion settlement failure attempt an automatic single `buy_now` retry before surfacing the residual to the buyer, or always hand control back to the buyer immediately?
- For the abandoned-order sweep: TTL value and whether it runs as a cron, on-read lazy cleanup, or a startup task.

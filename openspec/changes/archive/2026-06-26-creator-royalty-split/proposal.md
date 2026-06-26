## Why

On every secondary sale today, 100% of the proceeds (minus the platform fee) go
to whoever currently holds the card — the original creator earns nothing when
their card trades hands again. For a trading-card marketplace this is the most
valuable programmable-money story we can tell: **the creator gets paid
automatically, on-chain, every time their card resells**, enforced by the
settlement contract rather than honored voluntarily. We already split funds two
ways atomically; extending that to a contract-enforced creator royalty is a small
change with an outsized narrative for the Consumer & Merchant Payment Flows track.

## What Changes

- Each card carries an on-chain **creator account** and an immutable **royalty
  rate** (basis points), registered when the card is issued/registered.
- The settlement contract gains a per-card **royalty registry**: `list` reads the
  registered royalty and binds it to the listing; the seller cannot alter or
  bypass it.
- `accept_offer` and `buy_now` settle **three ways atomically** in one
  transaction: card → buyer, platform fee → platform, **creator royalty →
  creator**, remainder → seller. Still all-or-nothing.
- Royalty is **skipped on a primary sale** (when the seller *is* the creator) —
  royalties apply to resale, so the creator never pays themselves.
- Royalty rate is **capped** at initialization (e.g. ≤ 10%), and the combined
  fee + royalty can never exceed the sale amount.
- The indexer records the royalty leg; catalog and trade endpoints expose the
  creator and royalty so the UI can show the full split.
- The web trade view shows the **creator royalty line** in the settlement
  breakdown ("Creator earned X USDC").

## Capabilities

### New Capabilities
<!-- None — the royalty registry lives inside the existing settlement contract. -->

### Modified Capabilities
- `marketplace-settlement-contract`: settlement distributes a contract-enforced
  creator royalty as a third atomic leg; cards carry a registered royalty bound
  at listing time; royalty is skipped on primary sales and bounded by an
  initialization cap.
- `card-assets`: card issuance/registration records an on-chain creator account
  and an immutable royalty rate alongside existing metadata.
- `marketplace-api`: the indexer captures the royalty distribution from
  settlement events, and catalog/trade endpoints expose creator + royalty.
- `marketplace-web`: the settlement breakdown surfaces the creator royalty leg.

## Impact

- **Contract** (`packages/contracts/src/lib.rs`): `Listing` struct gains
  `creator` + `royalty_bps`; new royalty-registry storage + `set_royalty` (admin)
  / read path; `init` gains a royalty cap; `accept_offer` and `buy_now` add the
  royalty transfer; `settle` event extended with the royalty amount. New unit
  tests in `src/test.rs`.
- **Shared** (`packages/shared`): contract tx builders/types for the new
  `creator`/`royalty_bps` fields and `set_royalty`.
- **DB** (`packages/db`): card schema gains `creator_account` + `royalty_bps`;
  trade/settlement records gain a `royalty_amount`.
- **API** (`apps/api`): indexer parses the extended settle event; catalog + trade
  responses include creator/royalty.
- **Web** (`apps/web`): trade breakdown renders the royalty line.
- **Scripts** (`packages/scripts`): setup/seed registers a creator + royalty for
  demo cards; e2e asserts the three-way split.

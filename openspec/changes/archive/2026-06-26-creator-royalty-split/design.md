## Context

The settlement contract (`packages/contracts/src/lib.rs`) currently distributes a
sale **two ways** inside one atomic transaction: `seller_amount = amount - fee`
goes to the seller and `fee` goes to the platform. `accept_offer` distributes
from contract custody (funds were escrowed by `make_offer`); `buy_now` pulls
directly from the buyer. Both publish a `settle` event carrying
`(buyer, seller, amount, fee)`.

We want a **third, contract-enforced leg**: a creator royalty paid on every
*resale*. The hard constraints are that it must stay atomic (all-or-nothing),
must not be bypassable by the seller, and must be a small, low-risk diff to a
contract that already has passing unit tests and an e2e flow.

## Goals / Non-Goals

**Goals:**
- A creator royalty is paid in the **same atomic transaction** as settlement, for
  both `accept_offer` and `buy_now`.
- The royalty rate is **bound to the card, not the listing** — the seller cannot
  set it to zero or redirect it.
- Royalty applies to **secondary sales only**: when the seller is the creator
  (primary sale), no royalty is taken.
- `fee + royalty` can never exceed the sale amount; the seller's share is always
  non-negative.
- The royalty leg is observable: events, the indexer, the API, and the trade UI
  all surface it.

**Non-Goals:**
- Per-listing or seller-chosen royalty rates (rejected — defeats enforcement).
- Mutable royalty rates after a card is registered (kept immutable for trust).
- Multi-recipient / split-royalty trees, royalty in non-USDC assets, or
  off-chain royalty accounting — all out of scope for the hackathon.

## Decisions

### Decision 1: Royalty is registered per card in a contract registry, read at `list` time and frozen onto the listing

A new persistent storage map keys `card_token -> RoyaltyConfig { creator, bps }`.
An admin-only `set_royalty(card_token, creator, royalty_bps)` registers it
(idempotent until first use is acceptable for the demo; we keep it
admin-overwritable before any listing references it). `list` looks up the
registry and **copies** `creator` + `royalty_bps` onto the `Listing` struct, so
settlement reads from the immutable listing snapshot.

- **Why over alternatives:** Putting royalty on the *listing input* (seller
  passes it) is trivial but lets the seller bypass it — fatal for the narrative.
  Deriving the creator from the Stellar asset issuer is elegant but the issuer
  may be an operational key, not the artist's payout account, and gives us no
  rate. A registry decouples "who issued the asset" from "who gets paid and how
  much," and freezing onto the listing means a later registry change can't alter
  an already-open listing's economics.

### Decision 2: Skip royalty on primary sale (`seller == creator`)

In settlement, if `listing.seller == listing.creator`, set `royalty = 0`.
Royalties are a *resale* mechanic; a creator selling their own card should not
pay themselves (and a self-transfer of the same address is wasteful/confusing).

- **Why:** Matches the product story ("paid every time it *resells*") and avoids
  a degenerate transfer. Alternative — always pay — was rejected as semantically
  wrong and noisier in the demo.

### Decision 3: Royalty base is the gross sale amount; ordering is fee → royalty → seller

`fee = amount * fee_bps / 10_000`, `royalty = amount * royalty_bps / 10_000`
(zero on primary sale), `seller_amount = amount - fee - royalty`. The contract
asserts `fee + royalty <= amount` (guaranteed by the cap below) so
`seller_amount >= 0`. Transfers happen in the existing atomic block; if any leg
fails the whole tx reverts (unchanged behavior).

- **Why:** Computing both off the gross keeps the math obvious for judges ("2%
  platform, 5% creator, 93% seller") and mirrors the existing `split_fee` helper.
  Adding a `split_royalty` helper parallel to `split_fee` is the minimal diff.

### Decision 4: Bound the royalty by a cap set at `init`

`init` gains a `max_royalty_bps` parameter. `set_royalty` rejects any
`royalty_bps > max_royalty_bps`, and the cap is chosen so `fee_bps +
max_royalty_bps < 10_000`. This makes the `seller_amount >= 0` invariant a
compile-of-rules guarantee rather than a runtime hope.

- **Why:** Without a cap, a misconfigured royalty could zero out or invert the
  seller's proceeds. A single init-time bound is cheaper than per-call math and
  is self-documenting.

### Decision 5: Extend the `settle` event rather than add a new event

The `settle` event payload becomes `(buyer, seller, amount, fee, royalty,
creator)`. The indexer parses the extra fields; a zero royalty (primary sale) is
a normal value.

- **Why:** The indexer already subscribes to `settle`; widening the tuple is less
  surface area than a second event and keeps one settlement = one event.

## Risks / Trade-offs

- **[Registry not set for a card] →** `list` treats a missing registry entry as
  `royalty_bps = 0` (creator = seller), i.e. behaves exactly like today. No card
  is blocked from listing; royalty is purely additive.
- **[Admin overwrites royalty after listings exist] →** Mitigated by freezing
  `creator`/`royalty_bps` onto the `Listing` at `list` time; in-flight listings
  keep their original economics. Only future listings see a changed rate.
- **[Creator account lacks a USDC trustline] →** The royalty transfer would fail
  and (correctly, atomically) revert the whole settlement. Mitigation: the
  setup/seed script establishes the creator's USDC trustline; the API pre-flight
  for accept/buy-now validates the creator trustline alongside the buyer's.
- **[Event/tuple widening breaks the existing indexer parse] →** Update the
  indexer parser in the same change; covered by tasks and the e2e assertion on
  the three-way split.
- **[Rounding dust] →** Integer bps math can leave 1 stroop unaccounted; we
  define `seller_amount = amount - fee - royalty` (remainder absorbed by seller)
  so totals always reconcile exactly.

## Migration Plan

This is a testnet hackathon contract with no production state. Deploy is a
**redeploy + re-init** with the new `max_royalty_bps` arg; the demo accounts and
cards are regenerated by the existing setup/deploy scripts. Steps: rebuild
contract → redeploy → `init(..., max_royalty_bps)` → `set_royalty` for demo cards
→ re-seed. Rollback is redeploying the prior wasm; no data migration is required
because Postgres is a rebuildable mirror of chain state.

## Open Questions

- Demo royalty rate: 5% is a clean, recognizable number against the 2% platform
  fee — confirm before recording the demo.
- Whether `set_royalty` should be permanently locked after first use or remain
  admin-overwritable for demo convenience (current lean: overwritable, since
  listings freeze their own copy).

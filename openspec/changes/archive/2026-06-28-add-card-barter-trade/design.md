# Design: add-card-barter-trade

## Context

The settlement contract already handles two atomic settlement patterns: digital
(card-in-custody → buyer, USDC → seller/platform/creator, in one XCM) and
physical escrow (fund → ship → confirm/dispute). Both share the same "lock asset
until condition" primitive and require a single party's auth at settlement time.

Barter introduces a third pattern: **both parties must authorise, and assets
move in both directions simultaneously.** The existing `buy_now` / `accept_offer`
entrypoints cannot be reused because they assume one card token always moves
from contract custody to buyer, and USDC always flows buyer → seller. In a swap,
Party A gives cards to Party B and Party B gives different cards to Party A; the
USDC sweetener (if any) flows only one way.

The web today has `sendTrade` as a no-op and `MY_CARDS` as eight hardcoded rows.
This change replaces both with real on-chain mechanics.

## Goals / Non-Goals

**Goals**
- Atomic, all-or-nothing card-for-card exchange with optional one-way USDC sweetener.
- Propose → accept / decline / cancel / expire lifecycle; counterparty is targeted
  (not a broadcast offer).
- Counter-offers are modelled as new proposals; the original is not mutated.
- Platform fee applies **only when USDC moves** (on the USDC sweetener leg only);
  pure card-for-card swaps carry no fee.
- Both passkey smart-wallets and classic `G…` Stellar accounts can participate.
- Proposals expire after 7 days (configurable at API level, not in the contract).
- All past swap settlements are queryable and link to on-chain tx hashes.

**Non-Goals**
- Multi-hop trades (A→B→C chains).
- Broadcast trade requests / open-market swap listings.
- Physical-delivery escrow for barter (digital card transfers only in this change).
- Royalty on the card assets transferred in a swap (royalties apply to USDC cash
  sales; swapping cards directly does not trigger a USDC royalty payment — see
  Decision 4 below).

## Decisions

### Decision 1: Two-phase contract design — `propose_swap` + `execute_swap`

A single-transaction both-party swap is architecturally possible on Soroban
(both addresses in `require_auth()` calls, both signing the same XDR), but it
requires the API to coordinate two separate async signing operations and assemble
them into one envelope before broadcast. We model this as two separate on-chain
operations instead:

1. **`propose_swap(proposer, counterparty, give_tokens[], get_tokens[], usdc_amount)`**:
   proposer's card tokens are pulled into contract custody; a `SwapProposal` is
   stored; a `swap_proposed` event is emitted. Only proposer signs this tx.

2. **`execute_swap(counterparty, proposal_id)`**: counterparty's card tokens are
   pulled from counterparty into custody and simultaneously released to proposer;
   proposer's escrowed cards are released to counterparty; USDC sweetener (if any)
   is pulled from the USDC-payer and distributed atomically. Counterparty signs
   this tx. The `swap` event is emitted.

This keeps each signing step to a single party's auth — identical to the existing
`make_offer` / `accept_offer` pattern — and avoids the complexity of multi-party
envelope assembly.

**Trade-off**: a proposer's cards are locked in custody from proposal creation
until acceptance, cancellation, or expiry. This is acceptable and mirrors how
`make_offer` locks USDC.

### Decision 2: Fee on USDC sweetener only; pure card swaps are fee-free

In a direct sale, platform fee compensates for price discovery, liquidity, and
escrow risk. In a pure card swap, the platform provides matching and atomicity but
no price intermediation. Charging a fee on an undefined "card value" would require
oracles we do not have.

When a USDC sweetener is included, the platform provides the same USDC custody
and risk-mitigation service as in a regular sale, so a fee is appropriate. The
fee is applied to the sweetener amount using the same `split_fee` helper already
used by `buy_now` and `accept_offer`. No royalty is triggered on the card leg
(the creator royalty is a USDC-denominated payment; swapping the token itself does
not produce USDC to distribute from).

**Justification**: this keeps the mechanic simple, avoids oracle dependency, and
is consistent with collector expectations — collectors routinely swap cards
without cash changing hands and expect that to be zero-cost beyond gas.

### Decision 3: Expiry is enforced by the API, not the contract

Soroban ledger time is available, but baking a 7-day TTL into the contract adds
state-cleaning complexity. Instead the API enforces expiry: a background job marks
`trade_proposals` rows as `expired` after `expires_at`; the `cancel_swap` contract
call is used to return escrowed cards. The contract validates that the caller is
either the proposer (cancel) or the counterparty (decline), and that the proposal
status is `proposed`. The API sweeps expired proposals in a cron job and submits
`cancel_swap` transactions signed by the relayer on behalf of the expired proposer.

**Risk**: if the API's cron is delayed, proposer funds stay locked slightly longer
than 7 days. Acceptable — the proposer can also call `cancel_swap` directly.

### Decision 4: Counter-offers are new proposals, not mutations

Mutating an existing proposal to flip proposer/counterparty and change asset lists
would require complex state management and re-locking. Instead, a counter-offer is
a new `propose_swap` from the original counterparty back to the original proposer.
The original proposal is declined (returning its escrowed assets) as part of the
counter-offer flow; the web UI treats the pair as a "counter" thread.

**Trade-off**: two contract calls vs. one. Acceptable given the UX clarity.

### Decision 5: Dual-auth UX for passkey wallets

For passkey users (smart-wallet `C…` addresses), the `propose_swap` tx is
submitted through the existing passkey relay (`POST /api/tx/relay`). The
`execute_swap` tx similarly goes through the relay if the counterparty is also a
passkey wallet. If one side is a classic `G…` account, that side signs the XDR
client-side (same pattern as current classic-wallet `buy_now`). The API tx builder
for `execute_swap` returns unsigned XDR that the counterparty's wallet signs.

### Decision 6: `trade_proposals` DB table is the source of truth for lifecycle

The contract stores minimal state (`SwapProposal` with status). The `trade_proposals`
Postgres table mirrors this with richer metadata: card names, USDC amount, expiry,
human-readable status, and tx hashes. The indexer listens for `swap_proposed`,
`swap_cancelled`, and `swap` events to keep the table consistent, same as the
existing indexer pattern for `settle` events.

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Proposer's cards locked longer than expected (cron delay on expiry) | Low | Proposer can call `cancel_swap` directly at any time |
| Counterparty ignores proposal — assets locked indefinitely | Medium | Hard 7-day expiry via API cron + proposer self-cancel |
| Contract custody increases smart-contract risk surface | Low | No new asset types; same custody pattern as `make_offer` |
| Both sides must hold card tokens (no listing required) | Low | `GET /api/cards?owner=` already returns live holdings |
| Classic + passkey mixed pairs require careful relay logic | Medium | Reuse existing relay + passkey patterns; integration tested |

## Migration Plan

1. Deploy updated contract with `propose_swap` / `execute_swap` / `cancel_swap`.
2. Run DB migration to add `trade_proposals` table.
3. Deploy updated API with new routes and indexer listener.
4. Deploy updated web with real trade page and inbox.
5. Remove `MY_CARDS`, `EMPTY_TRADE`, `sendTrade`, `openTradePicker`, `addTradeCard`
   from `panels.ts` and `TopDeckProvider.tsx`.

## Open Questions

- Should the counterparty receive a push notification (email/in-app) on proposal
  receipt? Deferred to a future notification change — the inbox poll is sufficient
  for MVP.
- Should swaps be searchable in trade history the same way cash trades are? Yes —
  the `swap` event indexer writes to `trades` with `price_usdc = 0` (or sweetener
  amount) and a `swap_tx_hash`.

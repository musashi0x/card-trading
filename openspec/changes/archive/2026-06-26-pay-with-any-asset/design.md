## Context

The settlement contract is USDC-only. `buy_now` transfers USDC directly from the
buyer (`u.transfer(&buyer, &seller, …)`) and `accept_offer` distributes USDC that
`make_offer` escrowed from the buyer. In both cases the **buyer's account must
hold the USDC** at invocation time, with a USDC trustline. A buyer who only holds
XLM (or any other asset) cannot transact.

Stellar solves currency conversion natively: a `PathPaymentStrictReceive`
operation spends a source asset and delivers an **exact** amount of a destination
asset, routed through DEX/liquidity-pool order books, bounded by a caller-supplied
`sendMax`. Horizon exposes `/paths/strict-receive` to discover routes and price
them before signing. The API already wires a Horizon server (`apps/api/src/stellar.ts`)
and builds unsigned XDR for wallet signing — this change extends that pattern.

Protocol constraint that shapes the whole design: a Soroban transaction may carry
**only** its single `InvokeHostFunction` operation — it cannot also carry a classic
`PathPaymentStrictReceive`. Conversion and settlement therefore cannot share one
transaction; they must be two signed transactions, conversion first.

## Goals / Non-Goals

**Goals:**
- Let a buyer pay for a card with any asset they hold, converted to the exact
  USDC the settlement needs, priced by on-chain liquidity with slippage
  protection.
- Keep the settlement contract, its three-way split, and its USDC invariant
  completely unchanged.
- Surface an honest quote (estimated spend, slippage cap, fees) before the buyer
  commits, and fail pre-flight rather than mid-settlement.

**Non-Goals:**
- No on-contract swapping, AMM, or multi-asset accounting inside the contract.
- No custody of buyer funds or keys — every tx is wallet-signed.
- No support for sellers receiving anything other than USDC.
- No guaranteed best-price routing beyond what Horizon's path finder returns.

## Decisions

### Decision 1: Convert off-contract via `PathPaymentStrictReceive`, not on-contract
Conversion happens before settlement, in a separate classic transaction; the
contract keeps pulling USDC exactly as today.
- **Why:** Strict-*receive* guarantees the buyer ends up with the precise USDC
  amount the settlement requires (price for `buy_now`, offer amount for
  `make_offer`) — no dust, no shortfall. On-contract swapping would mean
  rebuilding settlement around a DEX the contract can't reach, for no narrative
  gain.
- **Alternatives considered:** (a) On-contract swap — rejected: Soroban can't
  route classic DEX liquidity, huge contract surface. (b) `StrictSend` (spend an
  exact amount, receive variable) — rejected: leaves the USDC amount uncertain,
  breaking the exact-funding requirement. (c) Bundle path-payment + settlement in
  one tx — impossible: a Soroban tx admits only its single host-function op.

### Decision 2: Path payment delivers USDC to the **buyer**, then settle
The path payment's destination is the buyer's own account; the existing
`buy_now` / `make_offer` step then spends that USDC.
- **Why:** The contract pulls USDC from the buyer under the buyer's Soroban auth,
  so the USDC must physically land in the buyer's account first. Delivering
  straight to seller/platform/creator would bypass the contract's atomic split
  and its escrow/refund guarantees.
- **Alternatives considered:** Delivering to the contract or seller — rejected:
  breaks the contract's accounting and the all-or-nothing settlement.

### Decision 3: Two-step flow with an explicit quote, gated on a USDC shortfall
Flow: **quote → (change_trust if needed) → path-payment top-up → settle**. The
top-up is skipped when the buyer's USDC balance already covers the amount.
- **Why:** Two transactions are unavoidable (Decision 1's protocol constraint).
  Making the quote explicit lets the UI show real numbers and lets pre-flight
  reject a stale price before the buyer signs anything. Gating on the shortfall
  means USDC-holding buyers see zero extra steps.
- **Top-up sizing:** request `destAmount = max(0, amountNeeded − currentUsdc)` so
  an existing partial USDC balance is used and only the gap is converted.

### Decision 4: Slippage as a bps bound baked into `sendMax`
The quote returns the path finder's `source_amount`; the build sets
`sendMax = source_amount × (1 + slippageBps/10_000)`.
- **Why:** `PathPaymentStrictReceive` fails atomically if the market moves past
  `sendMax`, so the buyer can never overpay beyond the cap. A default bound
  (e.g. 50–100 bps) is applied server-side and echoed to the UI; the contract
  and seller are insulated either way.
- **Alternatives considered:** No cap (`sendMax = i128::MAX`) — rejected: exposes
  the buyer to sandwiching/price moves. Client-chosen slippage only — deferred;
  start with a sane server default.

### Decision 5: Pre-flight in the API, mirroring the existing `PreflightError` pattern
Before returning the build, the API checks: buyer holds the source asset with
balance ≥ `sendMax`; a USDC trustline exists (else return a `change_trust` build
with a `MISSING_TRUSTLINE`-style code); a path exists (`NO_PATH` if Horizon
returns none).
- **Why:** Consistent with how `requireBalance` / `requireTrustline` already guard
  trade builds, and turns mid-settlement reverts into actionable, coded errors up
  front.

## Risks / Trade-offs

- **Price moves between quote and submit** → `sendMax` caps the loss; a moved
  market makes the path payment fail cleanly (atomic), so the buyer retries with a
  fresh quote rather than overpaying. Quotes are treated as short-lived.
- **Thin testnet liquidity for the chosen pair** → pre-flight returns `NO_PATH`;
  setup/seed scripts establish an XLM↔USDC path so the demo always has a route.
- **Two transactions instead of one** (sign twice) → inherent to the protocol;
  mitigated by skipping the top-up when USDC already suffices and by clear UI
  sequencing. The settlement itself remains atomic.
- **Buyer lacks a USDC trustline** → flow inserts a `change_trust` step before the
  path payment; surfaced as its own pre-flight code so the UI can prompt it.
- **Partial completion** (top-up succeeds, settlement then fails/abandoned) →
  buyer simply holds USDC they can spend on a retry; no funds are lost and no
  contract state changed. Acceptable; documented for the UI to message.

## Migration Plan

Purely additive. New API endpoints and shared types ship alongside the existing
ones; the web modal gains an optional asset picker that defaults to USDC (current
behavior). No DB migration, no contract redeploy. Rollback = hide the asset
picker and stop calling the new endpoints; all existing flows are untouched.

## Open Questions

- Should slippage be user-adjustable in the UI for the demo, or is a fixed
  server-side default sufficient? (Leaning: fixed default first.)
- Which source assets to surface in the picker — only assets the buyer actually
  holds (from Horizon balances), or a curated list including XLM?
- Quote freshness: enforce a TTL / re-quote on submit, or rely solely on
  `sendMax` to absorb drift?

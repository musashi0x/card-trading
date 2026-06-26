## Why

To buy a card today a buyer must already hold test **USDC** — the settlement
contract pulls USDC from the buyer and splits it to seller, platform, and
creator. Anyone arriving with only XLM (or any other Stellar asset) is stuck at
the moment of purchase and has to go swap first. Stellar's native DEX makes that
swap unnecessary: a **path payment** converts whatever the buyer holds into the
exact USDC a settlement needs, in one signed step, priced by on-chain
liquidity. Letting buyers **pay with any asset they already hold** removes the
single biggest friction point in the purchase flow and is a clean, on-the-nose
story for the Consumer & Merchant Payment Flows track — the merchant (seller)
always receives USDC, the buyer never has to think about it.

## What Changes

- A buyer can choose a **source asset** they hold (e.g. XLM) at buy/offer time;
  the marketplace converts it to the precise USDC the settlement requires using
  a **`PathPaymentStrictReceive`** against the Stellar DEX.
- New API **quote** step: given a listing (or intended offer amount) and the
  buyer's chosen source asset, the API queries Horizon strict-receive paths and
  returns the estimated send amount, a **slippage-bounded `sendMax`**, and the
  path to use.
- New API **build** step: returns an unsigned path-payment tx that delivers the
  exact destination USDC **to the buyer**, capped by `sendMax`, carrying the
  discovered path — signed by the wallet like every other tx (no key custody).
- The purchase flow gains an **optional top-up**: if the buyer's USDC balance is
  short, they sign+submit the path payment first, then proceed to the existing
  `buy_now` / `accept_offer` settlement unchanged. Buyers already holding enough
  USDC skip the step entirely.
- Pre-flight protects the buyer: verifies they hold enough of the source asset,
  auto-prompts a **USDC trustline** (`change_trust`) when missing, confirms a
  viable path exists, and rejects quotes whose price moved past the slippage
  bound.
- The web buy/offer modal gains an **asset picker** and a live quote line
  ("You pay ~X XLM → seller receives Y USDC"), with the slippage cap shown.
- **No settlement-contract changes.** The contract stays USDC-only; conversion
  happens off-contract, before settlement. This keeps the atomic three-way
  split untouched and the conversion concern cleanly separated.

## Capabilities

### New Capabilities
- `pay-with-any-asset`: convert a buyer's chosen source asset into the exact
  USDC a settlement needs via a slippage-bounded Stellar path payment —
  path discovery, quoting, the path-payment build, the USDC-trustline
  pre-flight, and the optional top-up-then-settle purchase flow.

### Modified Capabilities
- `marketplace-api`: adds the quote and path-payment build endpoints, the
  source-asset/balance/trustline/slippage pre-flight, and Horizon strict-receive
  path discovery; the existing `buy_now` / `accept_offer` build + submit paths
  are unchanged downstream of the top-up.
- `marketplace-web`: the buy/offer modal adds a source-asset picker and a live
  conversion quote (estimated spend, slippage cap, trustline prompt) before the
  existing settlement step.

## Impact

- **API** (`apps/api`): new routes (e.g. `POST /tx/quote-path`,
  `POST /tx/path-payment`) in `src/routes/tx.ts`; new Horizon path-finding +
  `PathPaymentStrictReceive` / `change_trust` builders and a slippage helper in
  `src/stellar.ts`.
- **Shared** (`packages/shared`): request/response types for path quotes and the
  path-payment build (source asset, dest USDC amount, sendMax, path, slippage
  bps); zod input schemas.
- **Web** (`apps/web`): buy/offer modal gains the asset picker + quote UI and the
  top-up → settle sequence in `lib.ts` / `TopDeckApp.tsx`.
- **Contract** (`packages/contracts`): none — settlement stays USDC-only.
- **Scripts** (`packages/scripts`): e2e covers a non-USDC buyer purchasing via
  path payment; setup ensures a tradable XLM↔USDC path exists on the test
  network for the demo.

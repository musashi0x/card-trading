# add-card-barter-trade

## Why

The trade page today is pure theatre: a user picks cards to give and cards to
get, optionally adds cash, hits "Send" — and nothing happens. `sendTrade` flips
`sent: true` in local React state, the proposal evaporates on page reload, and
the counterparty never sees it. The give-side card list (`MY_CARDS`) is eight
hardcoded demo rows that never reflect real holdings.

Collectors expect barter to be a first-class feature: "I'll give you my Charizard
BGS 9.5 plus $200 for your Luffy Holo PSA 10." Without a real implementation,
trust in the platform is low and unique trading volume is zero. Every competing
marketplace has at least a manual offer thread; we should have an on-chain
atomic swap.

## What Changes

### New

- **`card-barter-trade`** capability: a full propose → accept/decline/cancel/expire
  lifecycle. The proposer picks N of their own card assets and an optional USDC
  sweetener; the counterparty is a specific Stellar address (not a broadcast).
  On acceptance, all card tokens and USDC move atomically on-chain in a single
  Soroban transaction; either side can cancel before acceptance; proposals expire
  after 7 days.

### Modified

- **`marketplace-settlement-contract`**: a new `propose_swap` / `execute_swap`
  entrypoint pair. `propose_swap` locks both parties' card tokens into contract
  custody and records a pending swap; `execute_swap` requires both-party auth to
  release assets cross-directionally plus optional USDC in one atomic XCM
  operation. Fees on the cash leg apply only when USDC changes hands; pure
  card-for-card swaps carry no fee.

- **`marketplace-api`**: CRUD endpoints for trade proposals
  (`POST /api/trade-proposals`, `GET /api/trade-proposals?party=…`,
  `POST /api/trade-proposals/:id/accept`, `.../decline`, `.../cancel`); tx
  builders for `propose_swap` and `execute_swap`; indexer listens for `swap`
  events and records settlement.

- **`marketplace-web`**: the trade page sources the give-side from
  `GET /api/cards?owner=<wallet>` (real holdings), the get-side from live
  listings; submitting creates a real proposal via the API; an inbox tab shows
  incoming/outgoing proposals with accept/decline/counter actions; `MY_CARDS`,
  `TradeItem`, `TradeState`, `EMPTY_TRADE`, and the no-op `sendTrade` are removed.

## Capabilities

### New Capabilities
- `card-barter-trade`

### Modified Capabilities
- `marketplace-settlement-contract`
- `marketplace-api`
- `marketplace-web`

## Impact

- **Contract** (`packages/contracts/src/lib.rs`): new `SwapProposal` struct +
  storage key; `propose_swap` locks both sides' cards into custody; `execute_swap`
  requires both-party auth, transfers cards cross-directionally plus optional USDC
  (with fee on the cash leg), emits `swap` event; `cancel_swap` / `expire_swap`
  return assets.
- **Shared** (`packages/shared/src/contract.ts`): tx builders for
  `propose_swap`, `execute_swap`, `cancel_swap`.
- **DB** (`packages/db/src/schema.ts`): new `trade_proposals` table; new
  `swap_tx_hash` column on the `trades` table.
- **API** (`apps/api/src/routes/`): new `trade-proposals.ts` route file; indexer
  extension for `swap` events.
- **Web** (`apps/web/src/app/(marketplace)/trade/`): page rewritten; new
  `TradeInbox` component; `MY_CARDS`, `EMPTY_TRADE`, `TradeState`, `TradeItem`
  removed from `panels.ts`; `sendTrade`, `openTradePicker`, `addTradeCard` removed
  from `TopDeckProvider.tsx`.

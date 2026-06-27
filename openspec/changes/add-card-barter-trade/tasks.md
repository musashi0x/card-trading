# Tasks: add-card-barter-trade

## 1. Settlement contract — swap proposal storage and entrypoints

- [ ] 1.1 Add `SwapProposal` struct to `packages/contracts/src/lib.rs` with fields: `proposer: Address`, `counterparty: Address`, `give_tokens: Vec<Address>`, `get_tokens: Vec<Address>`, `usdc_amount: i128`, `status: u32` (using constants `SWAP_PROPOSED = 10`, `SWAP_ACCEPTED = 11`, `SWAP_CANCELLED = 12`, `SWAP_DECLINED = 13`).
- [ ] 1.2 Add `DataKey::SwapProposal(u32)` and `DataKey::SwapCount` variants; add `get_swap`, `put_swap` helpers.
- [ ] 1.3 Implement `propose_swap(env, proposer, counterparty, give_tokens, get_tokens, usdc_amount) -> u32`: validate not self-trade, validate `give_tokens` non-empty, transfer each give token from proposer into contract custody, store `SwapProposal`, emit `(swap_proposed, id)` event.
- [ ] 1.4 Implement `execute_swap(env, counterparty, proposal_id)`: validate `counterparty.require_auth()`, status == `SWAP_PROPOSED`, caller == `proposal.counterparty`; for each get token pull from counterparty into custody then release to proposer; release each give token from custody to counterparty; if `usdc_amount > 0` pull from proposer, compute and transfer fee to platform, remainder to counterparty; update status to `SWAP_ACCEPTED`; emit `(swap, proposal_id)` event.
- [ ] 1.5 Implement `cancel_swap(env, proposer, proposal_id)`: validate `proposer.require_auth()`, status == `SWAP_PROPOSED`, caller == `proposal.proposer`; return all give tokens from custody to proposer; update status to `SWAP_CANCELLED`; emit `(swap_cancel, proposal_id)` event.
- [ ] 1.6 Implement `decline_swap(env, counterparty, proposal_id)`: validate `counterparty.require_auth()`, status == `SWAP_PROPOSED`, caller == `proposal.counterparty`; return all give tokens from custody to proposer; update status to `SWAP_DECLINED`; emit `(swap_decline, proposal_id)` event.
- [ ] 1.7 Add view function `get_swap_view(env, proposal_id) -> SwapProposal`.

## 2. Settlement contract — tests

- [ ] 2.1 Add test `test_propose_swap_locks_cards`: verify give tokens are transferred to contract custody and `get_swap_view` returns the correct proposal after `propose_swap`.
- [ ] 2.2 Add test `test_execute_swap_atomic`: verify both sides' tokens are exchanged atomically, USDC fee distributed correctly, `swap` event emitted.
- [ ] 2.3 Add test `test_execute_swap_no_usdc_no_fee`: verify pure card-for-card swap emits no USDC transfers and `fee = 0`.
- [ ] 2.4 Add test `test_cancel_swap_returns_cards`: verify `cancel_swap` returns give tokens to proposer and status is `SWAP_CANCELLED`.
- [ ] 2.5 Add test `test_decline_swap_returns_cards`: verify `decline_swap` returns give tokens to proposer and status is `SWAP_DECLINED`.
- [ ] 2.6 Add test `test_propose_swap_self_trade_rejected`: verify `propose_swap` panics when proposer == counterparty.
- [ ] 2.7 Add test `test_execute_swap_wrong_counterparty_rejected`: verify `execute_swap` panics when caller != `proposal.counterparty`.
- [ ] 2.8 Update snapshot files in `src/test.rs` if any existing tests reference contract state that changed.

## 3. Database migration

- [ ] 3.1 Add migration in `packages/db/src/` creating `trade_proposals` table: `id` (uuid pk), `proposer` (text), `counterparty` (text), `give_card_ids` (text[] / jsonb), `get_card_ids` (text[] / jsonb), `cash_usdc` (bigint default 0), `fee_usdc` (bigint default 0), `status` (text: proposed|accepted|declined|cancelled|expired), `propose_tx_hash` (text nullable), `swap_tx_hash` (text nullable), `expires_at` (timestamptz), `created_at` (timestamptz default now()).
- [ ] 3.2 Add `swap_tx_hash` (text nullable) column to the existing `trades` table for swap-settled rows.
- [ ] 3.3 Export `trade_proposals` table from `packages/db/src/schema.ts` using the project's existing schema pattern.

## 4. Shared types and tx builders

- [ ] 4.1 Add `buildProposeSwapXdr(params: { proposer, counterparty, giveTokens, getTokens, usdcAmount, contractId, networkPassphrase })` to `packages/shared/src/contract.ts`.
- [ ] 4.2 Add `buildExecuteSwapXdr(params: { counterparty, proposalId, contractId, networkPassphrase })`.
- [ ] 4.3 Add `buildCancelSwapXdr(params: { proposer, proposalId, contractId, networkPassphrase })`.
- [ ] 4.4 Add `buildDeclineSwapXdr(params: { counterparty, proposalId, contractId, networkPassphrase })`.
- [ ] 4.5 Export `TradeProposal` TypeScript type matching the DB schema row from `packages/shared/src/types.ts` (or equivalent shared types file).

## 5. API — trade-proposals routes

- [ ] 5.1 Create `apps/api/src/routes/trade-proposals.ts` with `POST /api/trade-proposals`: validate body (give/get card ids, counterparty, optional cash_usdc); verify proposer holds give-side cards via Horizon; build `propose_swap` XDR; insert `trade_proposals` row with `status = proposed`; return XDR for client signing (or relay if passkey).
- [ ] 5.2 Add `GET /api/trade-proposals?party=<address>[&status=<status>]`: return all proposals where address is proposer or counterparty, joined with card metadata; support optional status filter.
- [ ] 5.3 Add `POST /api/trade-proposals/:id/accept`: validate caller == counterparty; build `execute_swap` XDR; relay or return for signing; on success update row to `status = accepted`.
- [ ] 5.4 Add `POST /api/trade-proposals/:id/decline`: validate caller == counterparty; build and submit `decline_swap` tx via relay; update row to `status = declined`.
- [ ] 5.5 Add `POST /api/trade-proposals/:id/cancel`: validate caller == proposer; build and submit `cancel_swap` tx via relay; update row to `status = cancelled`.
- [ ] 5.6 Register the `trade-proposals` router in the main API app (same pattern as other route files).

## 6. API — indexer extension and expiry cron

- [ ] 6.1 Extend the on-chain event indexer to handle `swap` events: parse `(proposer, counterparty, give_tokens, get_tokens, usdc_amount, fee)` from the event; update `trade_proposals` row to `status = accepted`; write `trades` row with `swap_tx_hash`, `price_usdc = cash_usdc`, `fee_usdc`, `buyer = counterparty`, `seller = proposer`, `settled_at = now()`.
- [ ] 6.2 Extend indexer to handle `swap_cancel` and `swap_decline` events: update `trade_proposals` row status accordingly.
- [ ] 6.3 Add expiry cron (or scheduled job) that queries `trade_proposals` where `status = proposed` and `expires_at < now()`, submits `cancel_swap` for each using the relayer account, and updates rows to `status = expired`.

## 7. Web — trade page rewrite

- [ ] 7.1 Rewrite `apps/web/src/app/(marketplace)/trade/page.tsx`: remove all references to `MY_CARDS`, `EMPTY_TRADE`, `TradeState`, `TradeItem`; replace give-side picker data source with `GET /api/cards?owner=<wallet>` hook; replace get-side with live listings (already wired); add counterparty address input field; replace `sendTrade` call with `POST /api/trade-proposals` API call.
- [ ] 7.2 Create `apps/web/src/components/topdeck/TradeInbox.tsx`: tabbed component with "Incoming" and "Outgoing" sections; poll or SWR-fetch `GET /api/trade-proposals?party=<wallet>`; render proposal cards with give/get card names, USDC sweetener, status badge, expiry countdown, and action buttons (Accept / Decline / Counter / Cancel).
- [ ] 7.3 Wire Accept button: call `POST /api/trade-proposals/:id/accept`, sign returned XDR (passkey or classic wallet), submit, refresh inbox.
- [ ] 7.4 Wire Decline button: call `POST /api/trade-proposals/:id/decline`, confirm on success, refresh inbox.
- [ ] 7.5 Wire Cancel button (outgoing proposals): call `POST /api/trade-proposals/:id/cancel`, confirm on success, refresh inbox.
- [ ] 7.6 Wire Counter button: decline original, pre-populate a new proposal form with terms reversed, allow user to edit and submit as a new proposal.
- [ ] 7.7 Add Trade Inbox tab/section to the trade page or main nav (alongside the existing trade builder UI).
- [ ] 7.8 Show swap settlements in trade history view: extend the existing trade history component to display swap rows (give-side card names + get-side card names instead of a single card, USDC sweetener, fee, `swap_tx_hash` link).

## 8. Remove mock data and no-op code

- [ ] 8.1 Delete `MY_CARDS` array from `apps/web/src/components/topdeck/panels.ts`.
- [ ] 8.2 Delete `TradeItem`, `TradeState`, and `EMPTY_TRADE` exports from `panels.ts`.
- [ ] 8.3 Remove `sendTrade`, `openTradePicker`, and `addTradeCard` actions and their state from `apps/web/src/components/topdeck/TopDeckProvider.tsx`.
- [ ] 8.4 Remove any TypeScript type imports of `TradeItem`, `TradeState`, `EMPTY_TRADE` from consuming files; update type references to use the new `TradeProposal` type from shared.
- [ ] 8.5 Verify no remaining import of `MY_CARDS`, `EMPTY_TRADE`, `TradeState`, `TradeItem`, `sendTrade`, `openTradePicker`, or `addTradeCard` exists in the codebase (`grep -r` check).

## 9. End-to-end tests

- [ ] 9.1 Add e2e test: Alice proposes [cardA] for [cardB] with 50 USDC sweetener; verify `propose_swap` locks cardA in custody and `trade_proposals` row is `status = proposed`.
- [ ] 9.2 Add e2e test: Bob accepts Alice's proposal; verify cardA in Bob's account, cardB in Alice's account, fee in platform account, `trade_proposals` status = `accepted`, `trades` row has `swap_tx_hash`.
- [ ] 9.3 Add e2e test: Alice proposes then cancels; verify cardA returned to Alice, `trade_proposals` status = `cancelled`.
- [ ] 9.4 Add e2e test: pure card-for-card swap (no USDC); verify `fee_usdc = 0`, no USDC transferred in the tx.

# Capability: marketplace-api

> Status: MODIFIED

## MODIFIED Requirements

### Requirement: Transaction building for trade actions
The API SHALL build unsigned Stellar transactions for list, cancel, make-offer, withdraw-offer, accept-offer, buy-now, propose-swap, execute-swap, cancel-swap, and decline-swap so the client can sign them in the user's wallet. When a contract-call simulation fails with a transient post-write lag — including the Soroban Asset Contract's trustline-missing revert (`Error(Contract, #13)` / "trustline entry is missing") emitted right after a mint+distribute — the API SHALL retry the build before failing, and SHALL surface a persistent failure as an actionable client error rather than an opaque 500.

#### Scenario: Build a make-offer transaction
- **WHEN** a buyer requests to make an offer on a listing
- **THEN** the API SHALL return an unsigned transaction invoking the contract's `make_offer`
- **AND** the API SHALL NOT hold or use the buyer's private key

#### Scenario: Pre-flight validation before building
- **WHEN** building a transaction that requires a trustline or sufficient balance
- **THEN** the API SHALL validate the prerequisite
- **AND** SHALL return a clear, actionable error if it is not met

#### Scenario: List built immediately after minting (Soroban lag)
- **WHEN** building a `list` transaction whose `transfer` simulation reverts with the Soroban Asset Contract trustline-missing error (`Error(Contract, #13)` / "trustline entry is missing") because the seller's just-distributed card balance is not yet visible to the Soroban RPC
- **THEN** the API SHALL treat it as a transient lagging-ledger error and retry the build within its bounded retry window
- **AND** SHALL return the unsigned transaction once the Soroban RPC reflects the trustline

#### Scenario: Seller genuinely lacks the card trustline
- **WHEN** the same simulation error persists after the API exhausts its retries
- **THEN** the API SHALL return a 400 `MISSING_TRUSTLINE`-style error identifying the seller and asset
- **AND** SHALL NOT return an opaque 500 `INTERNAL` error

### Requirement: Chain indexer reconciles state to Postgres
The API SHALL run an indexer that reconciles on-chain listing, offer, settlement, and swap state into the Postgres mirror, treating the chain as the source of truth, and SHALL record the creator royalty distributed at settlement and the fee distributed on swap cash legs.

#### Scenario: Settlement reflected after a trade
- **WHEN** a trade settles on-chain
- **THEN** the indexer SHALL update the listing to sold, the offer to settled, and record a trade row with the settlement transaction hash, platform fee, and creator royalty amount

#### Scenario: Reconcile on action
- **WHEN** a user completes a contract action
- **THEN** the API SHALL reconcile the affected records from chain state shortly afterward
- **AND** the chain state SHALL take precedence over any prior DB state

#### Scenario: Swap settlement indexed to trades
- **GIVEN** a `swap` event is emitted on-chain
- **THEN** the indexer SHALL write a `trades` row with `proposer`, `counterparty`, give/get card ids, `cash_usdc`, `fee_usdc`, `swap_tx_hash`, and `settled_at`
- **AND** SHALL update the corresponding `trade_proposals` row to `status = accepted`

## ADDED Requirements

### Requirement: Barter trade proposal CRUD

The API SHALL expose endpoints to create, list, accept, decline, and cancel barter
trade proposals; build the corresponding Soroban XDR for each action; and relay
passkey-authorised swap transactions.

#### Scenario: Proposer creates a trade proposal
- **WHEN** `POST /api/trade-proposals` is called with valid give/get card ids, counterparty, and optional USDC
- **THEN** the API SHALL build a `propose_swap` XDR, return it for signing, and (after relay/submission) record the `trade_proposals` row with `status = proposed`

#### Scenario: Counterparty lists incoming proposals
- **WHEN** `GET /api/trade-proposals?party=<address>` is called
- **THEN** the response SHALL include all proposals where the address is proposer or counterparty, with full card metadata and status

#### Scenario: Counterparty accepts a proposal
- **WHEN** `POST /api/trade-proposals/:id/accept` is called by the counterparty
- **THEN** the API SHALL build an `execute_swap` XDR, return it for signing, and (after relay/submission) update the proposal to `status = accepted` and write a `trades` row

#### Scenario: Counterparty declines a proposal
- **WHEN** `POST /api/trade-proposals/:id/decline` is called by the counterparty
- **THEN** the API SHALL build and submit a `decline_swap` transaction returning the proposer's cards, then update the proposal to `status = declined`

#### Scenario: Proposer cancels a proposal
- **WHEN** `POST /api/trade-proposals/:id/cancel` is called by the proposer
- **THEN** the API SHALL build and submit a `cancel_swap` transaction returning the proposer's cards, then update the proposal to `status = cancelled`

#### Scenario: Expired proposals are swept by the API cron
- **WHEN** the expiry cron finds proposals with `expires_at < now` and `status = proposed`
- **THEN** the cron SHALL submit `cancel_swap` for each and update those rows to `status = expired`

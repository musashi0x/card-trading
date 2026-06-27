## Purpose

Peer-to-peer card barter trades: propose, counter, accept, decline, or cancel a card-for-card swap with an optional USDC sweetener, settled atomically on-chain.
## Requirements
### Requirement: Propose a barter trade

A logged-in user SHALL be able to propose a card-for-card trade to a specific
counterparty by selecting cards from their real on-chain holdings and cards from
the counterparty's on-chain holdings or active listings, with an optional one-way
USDC sweetener. Submitting the proposal SHALL lock the proposer's selected card
tokens into contract custody and record the proposal with `status = proposed`.

#### Scenario: Proposer creates a trade proposal
- **GIVEN** Alice holds card tokens A1 and A2 on-chain
- **WHEN** Alice proposes to trade A1 + A2 for Bob's card B1 with a 50 USDC sweetener
- **THEN** A1 and A2 SHALL be transferred to contract custody atomically
- **AND** a `trade_proposals` row SHALL be created with `status = proposed`, the give/get card ids, `cash_usdc = 50`, and an `expires_at` 7 days from now
- **AND** a `swap_proposed` event SHALL be emitted on-chain with the proposal id

#### Scenario: Proposer cannot give cards they do not hold
- **WHEN** Alice attempts to include a card token she does not hold in the give-side
- **THEN** the contract SHALL reject the transaction
- **AND** no proposal SHALL be created

#### Scenario: Proposer cannot propose to themselves
- **WHEN** Alice sets herself as the counterparty
- **THEN** the API SHALL reject the request with a validation error before building any transaction

#### Scenario: Proposal appears in proposer's outgoing inbox
- **GIVEN** a proposal exists with `proposer = Alice`
- **WHEN** Alice loads her trade inbox
- **THEN** the proposal SHALL appear in the "Outgoing" tab with status `Pending` and the full card and USDC breakdown

### Requirement: Counterparty accepts, declines, or cancels a proposal

The counterparty SHALL be able to view incoming proposals and accept, decline, or
ignore them. On accept, all assets move atomically. On decline or proposer cancel,
all locked cards are returned to their original owners. Ignored proposals expire
automatically after 7 days.

#### Scenario: Counterparty accepts and assets swap atomically
- **GIVEN** a proposal with `status = proposed` where Alice gives [A1] for Bob's [B1]
- **WHEN** Bob accepts the proposal
- **THEN** B1 SHALL be pulled from Bob's account in the same transaction
- **AND** A1 SHALL be transferred to Bob from contract custody
- **AND** B1 SHALL be transferred to Alice
- **AND** the `trade_proposals` row SHALL be updated to `status = accepted`
- **AND** a `swap` event SHALL be emitted with both addresses, both card tokens, and the USDC amount
- **AND** if acceptance fails mid-transaction the entire transaction SHALL revert (all-or-nothing)

#### Scenario: Counterparty declines and proposer's cards are returned
- **GIVEN** a proposal with `status = proposed`
- **WHEN** Bob declines the proposal
- **THEN** all card tokens locked in contract custody SHALL be returned to Alice
- **AND** the `trade_proposals` row SHALL be updated to `status = declined`
- **AND** no assets from Bob SHALL have moved

#### Scenario: Proposer cancels before acceptance and cards are returned
- **GIVEN** a proposal with `status = proposed`
- **WHEN** Alice cancels the proposal before Bob accepts
- **THEN** all card tokens locked in contract custody SHALL be returned to Alice
- **AND** the `trade_proposals` row SHALL be updated to `status = cancelled`

#### Scenario: Proposal expires after 7 days
- **GIVEN** a proposal whose `expires_at` has passed and `status = proposed`
- **WHEN** the API expiry cron runs
- **THEN** the cron SHALL submit a `cancel_swap` transaction on behalf of the proposer
- **AND** the `trade_proposals` row SHALL be updated to `status = expired`
- **AND** all locked card tokens SHALL be returned to the proposer

### Requirement: Counter-offer is a new proposal

A counterparty who wants to negotiate rather than accept or decline outright SHALL
be able to submit a counter-offer, which is modelled as a new proposal from the
counterparty back to the original proposer.

#### Scenario: Counterparty counters with a new proposal
- **GIVEN** Alice proposed [A1] for [B1]
- **WHEN** Bob submits a counter-offer proposing [B1] for [A1 + A2]
- **THEN** the original proposal SHALL be declined (returning A1 to Alice's custody)
- **AND** a new proposal SHALL be created with `proposer = Bob`, `counterparty = Alice`, giving [B1] for [A1 + A2]
- **AND** Alice SHALL see both the declined original and the new incoming counter-offer in her inbox

### Requirement: USDC sweetener and fee

The platform SHALL collect a fee on the USDC sweetener leg (one-way cash payment from proposer to counterparty) using the same fee rate as direct sales. Pure card-for-card proposals with no USDC sweetener SHALL carry zero platform fee.

#### Scenario: Fee deducted from USDC sweetener on acceptance
- **GIVEN** a proposal with `cash_usdc = 100` (proposer pays counterparty)
- **WHEN** the counterparty accepts
- **THEN** the platform account SHALL receive `fee = cash_usdc * fee_bps / 10_000`
- **AND** the counterparty SHALL receive `cash_usdc - fee`
- **AND** the fee SHALL be recorded in the settled trade row

#### Scenario: Pure card swap has no fee
- **GIVEN** a proposal with `cash_usdc = 0`
- **WHEN** the counterparty accepts
- **THEN** no USDC SHALL transfer between any party
- **AND** the settled trade row SHALL record `fee_usdc = 0`

### Requirement: Swap settlement appears in trade history

Every accepted swap SHALL be persisted in the `trades` table and SHALL be
accessible via the trade history API and web views.

#### Scenario: Swap settlement indexed to trade history
- **GIVEN** a swap settles on-chain with a `swap` event
- **THEN** the indexer SHALL write a `trades` row with both parties, both sets of card ids, the USDC sweetener amount, the platform fee, and the `swap_tx_hash`
- **AND** `GET /api/trades` SHALL return the swap row alongside cash trade rows

# Capability: marketplace-web

> Status: MODIFIED

## MODIFIED Requirements

### Requirement: Verifiable trade history
The web app SHALL show trade history with the full settlement breakdown — covering both cash trades and card barter swaps — and a link to inspect each settlement on a block explorer.

#### Scenario: Inspect a settled trade
- **WHEN** a user views a settled cash trade
- **THEN** the app SHALL display price, platform fee, creator royalty, the seller's net proceeds, and a link opening the settlement transaction on a block explorer

#### Scenario: Primary sale shows no royalty
- **WHEN** a user views a settled trade where the seller was the card's creator
- **THEN** the app SHALL show the creator royalty as zero (or omit the royalty line)
- **AND** SHALL display the seller's proceeds as price minus the platform fee

#### Scenario: Accepted swap shown in trade history
- **GIVEN** a swap settled with `swap_tx_hash`
- **WHEN** the user opens Trade History
- **THEN** the swap row SHALL show the give-side cards, get-side cards, USDC sweetener (if any), platform fee, and a link to the on-chain swap transaction

## ADDED Requirements

### Requirement: Card barter trade — propose

The web app SHALL allow connected users to propose a peer-to-peer barter trade by
selecting cards from their real on-chain holdings (give side) and from the
counterparty's real on-chain holdings or active listings (get side), with an
optional one-way USDC sweetener. Submitting the proposal SHALL call the API to
lock give-side cards in contract custody and record the proposal. The `MY_CARDS`
static mock, `TradeItem`, `TradeState`, `EMPTY_TRADE` types, and the no-op
`sendTrade`, `openTradePicker`, `addTradeCard` actions SHALL be removed.

#### Scenario: Proposer selects real holdings on the give side
- **GIVEN** a connected user with card tokens on-chain
- **WHEN** the user opens the trade page
- **THEN** the give-side card picker SHALL display only cards returned by `GET /api/cards?owner=<wallet>`
- **AND** no static mock data (`MY_CARDS`) SHALL appear

#### Scenario: Proposer submits a proposal
- **GIVEN** the proposer has selected give-side cards, get-side cards, and a counterparty address
- **WHEN** the user clicks Propose Trade
- **THEN** the app SHALL call `POST /api/trade-proposals`, build and relay the `propose_swap` XDR, and confirm the proposal is pending in the inbox

#### Scenario: Proposal requires counterparty address
- **WHEN** the proposer attempts to submit without entering a counterparty address
- **THEN** the form SHALL show a validation error and prevent submission

### Requirement: Card barter trade — inbox and actions

The web app SHALL display a trade inbox showing all incoming and outgoing proposals
for the connected wallet. Each proposal SHALL show the full card breakdown, USDC
sweetener, status, expiry, and available actions (accept, decline, counter, cancel).

#### Scenario: Incoming proposal appears in inbox
- **GIVEN** a proposal with `counterparty = connected wallet`
- **WHEN** the user opens the Trade Inbox tab
- **THEN** the proposal SHALL appear with the give/get card names, USDC amount, proposer address, status, and time remaining

#### Scenario: Counterparty accepts a proposal
- **GIVEN** an incoming proposal with `status = proposed`
- **WHEN** the counterparty clicks Accept
- **THEN** the app SHALL call `POST /api/trade-proposals/:id/accept`, build and relay `execute_swap` XDR, and confirm both card transfers on success

#### Scenario: Counterparty declines a proposal
- **GIVEN** an incoming proposal with `status = proposed`
- **WHEN** the counterparty clicks Decline
- **THEN** the app SHALL call `POST /api/trade-proposals/:id/decline` and the proposal SHALL move to status `Declined`

#### Scenario: Proposer cancels an outgoing proposal
- **GIVEN** an outgoing proposal with `status = proposed`
- **WHEN** the proposer clicks Cancel
- **THEN** the app SHALL call `POST /api/trade-proposals/:id/cancel` and the locked cards SHALL be returned

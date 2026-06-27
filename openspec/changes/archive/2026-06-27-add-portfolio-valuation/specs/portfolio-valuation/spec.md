## Purpose

For a connected wallet, resolve real on-chain card holdings, value each holding
via a market-price waterfall, compute cost basis from the account's own purchase
trades, aggregate totals and unrealized P&L, produce allocation by rarity,
identify best/worst performers, and synthesize a 12-month monthly value-history
series — all returned in a single API response.

## ADDED Requirements

### Requirement: Holdings resolution from on-chain state
The portfolio-valuation capability SHALL resolve card holdings from on-chain
state using the same path as the card catalog (`filterHeldCards`), and SHALL
include cards that are currently open-listed (the account still owns them
until settlement).

#### Scenario: Wallet holds cards on-chain
- **WHEN** a portfolio request is made for an account that holds cards on-chain
- **THEN** the response SHALL list each held card as a holding entry with its
  card metadata (name, rarity, asset code, image)
- **AND** SHALL include any cards currently listed for sale by that account,
  flagged with `listed: true`

#### Scenario: Wallet holds nothing
- **WHEN** a portfolio request is made for an account with no on-chain card
  holdings
- **THEN** the response SHALL return an empty holdings array, `totalValue: 0`,
  `totalCost: 0`, and a 12-month history series of all zeros

#### Scenario: Unknown or unfunded account
- **WHEN** a portfolio request is made for an account that does not exist on-chain
  or has not been funded
- **THEN** the capability SHALL treat it as holding nothing and return the same
  empty-portfolio shape without an error

#### Scenario: Invalid account address
- **WHEN** a portfolio request is made with an address that does not match the
  Stellar address pattern
- **THEN** the API SHALL return a `400` with a machine-readable `INVALID_ACCOUNT`
  error code and SHALL NOT query the chain

### Requirement: Per-card valuation with market-price waterfall
Each holding SHALL be valued using a three-tier waterfall: most recent settled
trade price for that card, then the lowest open listing price, then zero (with a
`valuedAt: null` sentinel).

#### Scenario: Card has settled trade history
- **WHEN** a card in the portfolio has at least one settled trade (any buyer/seller)
- **THEN** its current value SHALL be the `price_usdc` of the most recent settled
  trade (highest `settled_at`) for that card
- **AND** `valuedAt` SHALL be `"trade"`

#### Scenario: Card has no trades but has open listings
- **WHEN** a card in the portfolio has no settled trades but has at least one
  open listing
- **THEN** its current value SHALL be the minimum `price_usdc` among open listings
  for that card
- **AND** `valuedAt` SHALL be `"listing"`

#### Scenario: Card has neither trades nor open listings
- **WHEN** a card in the portfolio has no settled trades and no open listings
- **THEN** its current value SHALL be `0` and `valuedAt` SHALL be `null`

#### Scenario: Value history uses only data available at each month boundary
- **WHEN** computing the value-history series for a prior month
- **THEN** each month's per-card value SHALL be derived from trades and listings
  whose timestamps fall at or before that month's last day
- **AND** the current month's value SHALL equal the live total from the holdings
  response

### Requirement: Cost basis from the account's own purchase trades
Each holding SHALL carry a `costBasis` derived from the account's most recent
purchase trade for that card. Holdings with no purchase trade record SHALL carry
`costBasis: 0` and `costBasisKnown: false`.

#### Scenario: Account purchased the card on the marketplace
- **WHEN** a holding corresponds to a card the account bought (trade.buyer =
  account, linked via listing → card)
- **THEN** `costBasis` SHALL be the `price_usdc` of the most recent such trade
- **AND** `costBasisKnown` SHALL be `true`

#### Scenario: Account received the card without a purchase trade
- **WHEN** a holding has no trade row with `buyer = account` for that card (e.g.
  minted directly or transferred off-chain)
- **THEN** `costBasis` SHALL be `0` and `costBasisKnown` SHALL be `false`
- **AND** that holding SHALL be excluded from best/worst performer ranking

### Requirement: Portfolio totals and unrealized P&L
The response SHALL include `totalValue`, `totalCost`, `unrealizedGain`, and
`unrealizedGainPct`, aggregated across all holdings with known cost basis.

#### Scenario: Mixed holdings — some with cost basis, some without
- **WHEN** the portfolio contains holdings with and without a known cost basis
- **THEN** `totalCost` SHALL sum only the `costBasis` of holdings where
  `costBasisKnown: true`
- **AND** `unrealizedGainPct` SHALL be computed as `unrealizedGain / totalCost`
  only when `totalCost > 0`, and `null` otherwise

#### Scenario: All holdings have unknown cost basis
- **WHEN** every holding has `costBasisKnown: false`
- **THEN** `totalCost` SHALL be `0`, `unrealizedGain` SHALL be `0`, and
  `unrealizedGainPct` SHALL be `null`

### Requirement: Allocation by rarity
The response SHALL include a rarity-allocation breakdown expressed as the
value-share of each rarity group present in the portfolio.

#### Scenario: Portfolio spans multiple rarities
- **WHEN** the portfolio contains cards of different rarities
- **THEN** the response SHALL include one allocation entry per present rarity with
  `rarity`, `value`, and `pct` (share of `totalValue`, 0–100)
- **AND** entries SHALL be ordered: legendary, epic, rare, common

#### Scenario: Portfolio contains only one rarity
- **WHEN** all held cards share a single rarity
- **THEN** the allocation array SHALL contain exactly one entry with `pct: 100`

### Requirement: Best and worst performers
The response SHALL identify the single best and worst performing holding by
unrealized return percentage, considering only holdings with `costBasisKnown: true`.

#### Scenario: At least two holdings with known cost basis
- **WHEN** the portfolio contains two or more holdings with a known cost basis
- **THEN** `bestPerformer` SHALL be the holding with the highest
  `(value - costBasis) / costBasis` ratio
- **AND** `worstPerformer` SHALL be the holding with the lowest ratio

#### Scenario: Fewer than two holdings with known cost basis
- **WHEN** zero or one holding has a known cost basis
- **THEN** `bestPerformer` and `worstPerformer` SHALL both be `null` in the
  response

### Requirement: 12-month value-history series
The response SHALL include a `history` array of 12 monthly snapshots
(oldest-first, ending at the current month) where each entry has `month` (YYYY-MM)
and `value` (portfolio value synthesized from trade and listing data at that time).

#### Scenario: Account with purchases spread across multiple months
- **WHEN** the account's purchase trades span multiple calendar months
- **THEN** the history series SHALL show increasing portfolio value in months where
  cards were acquired and valued at the market price available at month-end
- **AND** months before any acquisition SHALL have `value: 0`

#### Scenario: Account with no trade history
- **WHEN** the account has no purchase or sale trades
- **THEN** all 12 history entries SHALL have `value: 0`

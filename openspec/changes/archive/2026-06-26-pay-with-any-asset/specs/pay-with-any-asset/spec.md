## ADDED Requirements

### Requirement: Convert any held asset to the exact settlement USDC

The system SHALL let a buyer fund a purchase with a source asset they hold by
converting it into the exact USDC amount a settlement requires, using a Stellar
`PathPaymentStrictReceive` whose destination is the buyer's own account. The
settlement contract SHALL remain USDC-only; conversion SHALL occur in a separate
transaction submitted before settlement.

#### Scenario: Buyer holding only XLM buys a card

- **WHEN** a buyer who holds XLM but insufficient USDC chooses XLM as the source
  asset for a `buy_now` priced in USDC
- **THEN** the system SHALL build a path payment delivering exactly the required
  USDC to the buyer, sourced from XLM
- **AND** after that payment confirms, the buyer SHALL complete the unchanged
  `buy_now` settlement, leaving the seller paid in USDC

#### Scenario: Settlement contract is not modified

- **WHEN** any pay-with-any-asset purchase settles
- **THEN** the contract SHALL receive and distribute USDC exactly as for a
  native-USDC purchase, with no contract-side asset conversion

### Requirement: Quote a conversion before the buyer commits

The system SHALL produce a quote, prior to building the path payment, that
discovers a route via Horizon strict-receive path finding and reports the
estimated source-asset spend, the destination USDC amount, the slippage-bounded
`sendMax`, and the path to use.

#### Scenario: Quote returns an estimate and a cap

- **WHEN** a buyer requests a quote for a source asset and a destination USDC
  amount
- **THEN** the system SHALL return the estimated source amount, the `sendMax`
  including the slippage bound, and the discovered path
- **AND** the quote SHALL reflect current on-chain liquidity from Horizon

#### Scenario: No viable path exists

- **WHEN** Horizon returns no path from the source asset to USDC for the
  requested amount
- **THEN** the system SHALL reject the quote with a machine-readable `NO_PATH`
  code rather than building an unusable transaction

### Requirement: Slippage protection bounds buyer spend

The path payment SHALL set `sendMax` to the quoted source amount increased by a
configured slippage bound in basis points, so the buyer can never spend more than
`sendMax`. If the market moves past the bound, the path payment SHALL fail
atomically without partial conversion.

#### Scenario: Price stays within the bound

- **WHEN** the buyer signs and submits the path payment and the market price is
  within the slippage bound
- **THEN** the conversion SHALL succeed, spending at most `sendMax` of the source
  asset and delivering the exact destination USDC

#### Scenario: Price moves beyond the bound

- **WHEN** the market price moves so the conversion would exceed `sendMax`
- **THEN** the path payment SHALL fail with no asset converted, and the buyer
  SHALL be able to retry with a fresh quote

### Requirement: Pre-flight guards the conversion

Before returning a path-payment build, the system SHALL verify the buyer holds at
least `sendMax` of the source asset and holds a USDC trustline. A missing
trustline SHALL be surfaced as an actionable coded error with a `change_trust`
build, and insufficient source balance SHALL be rejected with a coded error.

#### Scenario: Buyer is missing a USDC trustline

- **WHEN** a buyer without a USDC trustline requests a path-payment build
- **THEN** the system SHALL return a `MISSING_TRUSTLINE` code and a `change_trust`
  transaction to establish the USDC trustline first

#### Scenario: Buyer lacks enough of the source asset

- **WHEN** the buyer's source-asset balance is below the quoted `sendMax`
- **THEN** the system SHALL reject the build with an `INSUFFICIENT_BALANCE` code
  identifying the source asset

### Requirement: Top-up is skipped when USDC already suffices

The system SHALL request conversion only for the shortfall between the USDC
amount needed and the buyer's current USDC balance. When the buyer already holds
enough USDC, no path payment SHALL be built and the buyer SHALL proceed directly
to settlement.

#### Scenario: Buyer already holds enough USDC

- **WHEN** a buyer whose USDC balance already covers the price chooses to buy
- **THEN** the system SHALL not build a path payment and SHALL proceed straight
  to the existing settlement step

#### Scenario: Buyer holds a partial USDC balance

- **WHEN** a buyer holds some but not enough USDC and selects a source asset
- **THEN** the system SHALL size the conversion to only the missing amount

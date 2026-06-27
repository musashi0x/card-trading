## ADDED Requirements

### Requirement: Path-payment conversion endpoints

The API SHALL expose endpoints to quote a source-asset → USDC conversion and to
build an unsigned `PathPaymentStrictReceive` transaction that delivers the exact
USDC a settlement needs to the buyer. The quote endpoint SHALL use Horizon
strict-receive path finding; the build endpoint SHALL return wallet-signable XDR
with no key custody, consistent with the existing trade-build endpoints.

#### Scenario: Quote a conversion

- **WHEN** a client requests a quote with a buyer, a source asset, and a
  destination USDC amount
- **THEN** the API SHALL return the estimated source amount, the slippage-bounded
  `sendMax`, and the discovered path from Horizon
- **AND** SHALL return a `NO_PATH` code when no route exists

#### Scenario: Build a path-payment transaction

- **WHEN** a client requests a path-payment build for a quoted conversion
- **THEN** the API SHALL return an unsigned `PathPaymentStrictReceive` envelope
  delivering the exact destination USDC to the buyer, capped at `sendMax`, with
  the path embedded
- **AND** the network passphrase the wallet must sign against

### Requirement: Pre-flight for asset conversion

The API SHALL validate a conversion request before returning a build: the buyer
SHALL hold at least `sendMax` of the source asset and SHALL hold a USDC
trustline. Failures SHALL be returned as structured, machine-readable errors,
and a missing USDC trustline SHALL be accompanied by a `change_trust` build.

#### Scenario: Missing USDC trustline

- **WHEN** the buyer has no USDC trustline
- **THEN** the API SHALL respond with a `MISSING_TRUSTLINE` code and a
  `change_trust` transaction to create it

#### Scenario: Insufficient source-asset balance

- **WHEN** the buyer's source-asset balance is below `sendMax`
- **THEN** the API SHALL respond with an `INSUFFICIENT_BALANCE` code identifying
  the source asset, and SHALL not return a path-payment build

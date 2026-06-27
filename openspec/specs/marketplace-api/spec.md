## Purpose

Serve catalog and search from the Postgres mirror, build and submit unsigned Stellar transactions for trade actions, and reconcile on-chain state back into the mirror.
## Requirements
### Requirement: Card and listing catalog
The API SHALL expose endpoints to browse and search cards and open listings, served from the Postgres mirror, including each card's creator and royalty rate.

#### Scenario: Browse open listings
- **WHEN** a client requests the listings catalog
- **THEN** the API SHALL return open listings with card metadata, price, seller, and the card's creator and royalty rate
- **AND** results SHALL be served from Postgres for fast response

#### Scenario: Search cards
- **WHEN** a client searches by card name, set, or rarity
- **THEN** the API SHALL return matching cards and their open listings

### Requirement: Transaction building for trade actions
The API SHALL build unsigned Stellar transactions for list, cancel, make-offer, withdraw-offer, accept-offer, and buy-now so the client can sign them in the user's wallet.

#### Scenario: Build a make-offer transaction
- **WHEN** a buyer requests to make an offer on a listing
- **THEN** the API SHALL return an unsigned transaction invoking the contract's `make_offer`
- **AND** the API SHALL NOT hold or use the buyer's private key

#### Scenario: Pre-flight validation before building
- **WHEN** building a transaction that requires a trustline or sufficient balance
- **THEN** the API SHALL validate the prerequisite
- **AND** SHALL return a clear, actionable error if it is not met

### Requirement: Chain indexer reconciles state to Postgres
The API SHALL run an indexer that reconciles on-chain listing, offer, and settlement state into the Postgres mirror, treating the chain as the source of truth, and SHALL record the creator royalty distributed at settlement.

#### Scenario: Settlement reflected after a trade
- **WHEN** a trade settles on-chain
- **THEN** the indexer SHALL update the listing to sold, the offer to settled, and record a trade row with the settlement transaction hash, platform fee, and creator royalty amount

#### Scenario: Reconcile on action
- **WHEN** a user completes a contract action
- **THEN** the API SHALL reconcile the affected records from chain state shortly afterward
- **AND** the chain state SHALL take precedence over any prior DB state

### Requirement: Trade history with verifiable references
The API SHALL expose trade history where each settled trade includes the on-chain settlement transaction hash and the full fund distribution.

#### Scenario: View a settled trade
- **WHEN** a client requests trade history
- **THEN** each trade SHALL include buyer, seller, price, platform fee, creator royalty amount, and a settlement transaction hash usable to look it up on a block explorer

### Requirement: Pre-flight validates the creator trustline before settlement
The API SHALL validate that the card creator can receive their royalty before building a settlement transaction that pays a non-zero royalty.

#### Scenario: Creator missing a USDC trustline
- **WHEN** building an `accept_offer` or `buy_now` transaction for a card with a non-zero royalty
- **THEN** the API SHALL validate the creator's USDC trustline
- **AND** SHALL return a clear, actionable error if it is not met

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

### Requirement: Relay submission of passkey-authorized transactions

The API SHALL accept a passkey-authorized Soroban invocation (host function plus signed authorization entries) and submit it through a fee-sponsoring relay, then reconcile the marketplace DB rows exactly as it does for a wallet-signed submission. The relay provider MUST be configurable.

#### Scenario: Submit a passkey-authorized buy_now

- **WHEN** the API receives a passkey-authorized `buy_now` (host function + signed auth entries) for a known listing
- **THEN** the API relays it through the sponsoring relay
- **AND** on success records the trade with the smart-wallet `C…` address as buyer and marks the listing sold
- **AND** returns the on-chain transaction hash

#### Scenario: Relay rejects the submission

- **WHEN** the sponsoring relay returns an error or times out
- **THEN** the API SHALL return a structured, actionable error and SHALL NOT mutate listing/offer/trade state

### Requirement: Contract-address buyer pre-flight

The API pre-flight SHALL accept a contract-address (`C…`) buyer for `buy_now` and `make_offer`, validating USDC balance/availability for the smart-wallet account, and SHALL accommodate a smart wallet that is not yet deployed (deploy-on-first-use) without failing pre-flight.

#### Scenario: Pre-flight for a smart-wallet buyer

- **WHEN** a build/submit request names a `C…` smart-wallet address as buyer
- **THEN** pre-flight validates the smart wallet's USDC funding for the purchase amount
- **AND** does not require a classic `G…` trustline check that is inapplicable to the contract account

#### Scenario: Buyer wallet not yet deployed

- **WHEN** the smart-wallet buyer has not yet been deployed on-chain
- **THEN** pre-flight SHALL NOT reject the request solely for the account being undeployed
- **AND** the submission path includes the deployment so the purchase can complete in one flow


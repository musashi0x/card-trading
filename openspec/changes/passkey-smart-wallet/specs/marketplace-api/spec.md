## ADDED Requirements

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

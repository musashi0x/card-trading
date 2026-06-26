## Purpose

Enable consumers to create and use a Stellar smart-wallet account secured by a WebAuthn passkey (Face ID / Touch ID), authorize marketplace transactions without a seed phrase or browser extension, and submit those transactions gaslessly through a fee-sponsoring relay.

## Requirements

### Requirement: Passkey wallet creation

The system SHALL let a consumer create a Stellar smart-wallet account from a single WebAuthn/passkey ceremony, with no seed phrase and no browser extension. The created wallet SHALL be a Soroban smart-contract account (a `C…` address) whose authorization is verified by a secp256r1 passkey signature.

#### Scenario: First-time consumer creates a passkey wallet

- **WHEN** a consumer with no existing wallet chooses "Pay with Face ID" / "Create passkey wallet"
- **THEN** the platform authenticator prompts for biometric confirmation (Face ID / Touch ID)
- **AND** a smart-wallet contract account is associated with the resulting passkey credential
- **AND** the consumer is shown as connected with a `C…` smart-wallet address, having entered no seed phrase

#### Scenario: No platform authenticator available

- **WHEN** the consumer's device or browser does not support WebAuthn platform authenticators
- **THEN** the system SHALL hide or disable the passkey option and SHALL surface the existing extension/keypair wallet path instead

### Requirement: Passkey wallet recovery

The system SHALL allow a returning consumer to reconnect to their existing smart wallet using their passkey, without re-entering any secret.

#### Scenario: Returning consumer reconnects

- **WHEN** a returning consumer chooses "Connect with passkey"
- **THEN** the authenticator prompts for the existing passkey credential
- **AND** the system resolves the same smart-wallet `C…` address that was created previously
- **AND** the consumer is connected without creating a new wallet

### Requirement: Passkey authorization of marketplace calls

The system SHALL produce a passkey signature over the Soroban authorization entry for a marketplace contract call (`buy_now`, `make_offer`), so the smart wallet is the authorized actor of record. The signed authorization MUST be verifiable on-chain by the smart wallet's `__check_auth`.

#### Scenario: Consumer authorizes a purchase with a passkey

- **WHEN** a connected passkey consumer confirms a `buy_now` (or `make_offer`)
- **THEN** the system requests a passkey signature scoped to that contract call's authorization entry
- **AND** the resulting authorized invocation names the smart-wallet `C…` address as the buyer
- **AND** the on-chain settlement records the smart wallet as the buyer

#### Scenario: Consumer declines the biometric prompt

- **WHEN** the consumer dismisses or fails the biometric prompt
- **THEN** no transaction is submitted
- **AND** the system surfaces a cancellable, retryable state with no error left in the listing

### Requirement: Deploy-on-first-use

The system SHALL deploy the smart-wallet contract account transparently on the consumer's first authorized action, so a consumer can create a wallet and complete their first purchase in one flow.

#### Scenario: First purchase deploys the wallet

- **WHEN** a consumer whose smart wallet is not yet deployed confirms their first purchase
- **THEN** the smart-wallet deployment and the marketplace call are submitted together (or deployment immediately precedes the call)
- **AND** the consumer completes the purchase without a separate, visible "deploy wallet" step

### Requirement: Gasless submission via sponsoring relay

The system SHALL submit passkey-authorized transactions through a fee-sponsoring relay so the consumer never needs XLM to pay transaction fees. The relay integration MUST be abstracted so the relay provider can be swapped without changing the checkout flow.

#### Scenario: Consumer pays without holding XLM

- **WHEN** a passkey consumer with no XLM balance confirms a purchase
- **THEN** the passkey-authorized transaction is relayed through the sponsoring relay
- **AND** the transaction is accepted on-chain with fees covered by the relay
- **AND** the consumer's purchase succeeds without the consumer funding fees

#### Scenario: Relay submission fails

- **WHEN** the sponsoring relay rejects or times out on a submission
- **THEN** the system SHALL surface an actionable error and SHALL NOT mark the listing as sold
- **AND** the consumer MAY retry the purchase

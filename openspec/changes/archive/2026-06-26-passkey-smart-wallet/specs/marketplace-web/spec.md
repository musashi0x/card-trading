## ADDED Requirements

### Requirement: Passkey connect option

The web app SHALL offer a passkey ("Pay with Face ID") connection path alongside the existing extension/keypair wallet connectors, and SHALL track a connected smart-wallet account distinctly from a classic keypair account.

#### Scenario: Consumer connects with a passkey

- **WHEN** a visitor opens the wallet-connect surface on a passkey-capable device
- **THEN** a "Pay with Face ID" / passkey option is presented alongside the existing connectors
- **AND** selecting it connects a smart-wallet account whose `C…` address drives "my listings", balances, and checkout

#### Scenario: Existing connectors remain available

- **WHEN** a user prefers an extension or keypair wallet
- **THEN** the existing `@creit.tech/stellar-wallets-kit` connect flow remains available and unchanged as the default for sellers and power users

### Requirement: Face ID checkout flow

The web app SHALL provide a single-confirm checkout for `buy_now` and `make_offer` when connected via passkey: a biometric prompt followed by a clear pending → success (or retryable error) state, without an extension popup.

#### Scenario: One-tap buy

- **WHEN** a passkey-connected consumer taps "Buy now" on a real listing
- **THEN** the app triggers one biometric prompt to authorize the purchase
- **AND** shows a pending state while the transaction is relayed
- **AND** transitions to a success state reflecting the completed on-chain settlement

#### Scenario: Checkout error is recoverable

- **WHEN** authorization is declined or submission fails
- **THEN** the checkout returns to a cancellable, retryable state
- **AND** the listing is not shown as purchased

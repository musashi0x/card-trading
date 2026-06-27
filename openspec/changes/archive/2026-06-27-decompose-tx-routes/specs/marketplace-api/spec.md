## ADDED Requirements

### Requirement: Settlement reconciliation is identical across wallet types

The API SHALL reconcile a settled trade action into the Postgres mirror through a single, wallet-agnostic code path, so that a classic-wallet (`G…`) settlement and a passkey smart-wallet (`C…`) settlement of the same action produce identical database effects. The buyer/seller of record SHALL be the only input that differs between the two wallet types: the transaction source for a classic settlement, and the smart-wallet contract address for a passkey settlement.

#### Scenario: Buy-now reconciles identically for both wallet types

- **WHEN** a `buy_now` settles, whether submitted from a classic wallet (via `/submit`) or relayed from a passkey smart wallet (via `/passkey-submit`)
- **THEN** the API SHALL mark the listing sold and record one trade row with the same price, platform fee, creator royalty, and settlement transaction hash
- **AND** the recorded buyer SHALL be the classic transaction source or the smart-wallet contract address respectively

#### Scenario: Reconciliation is exhaustive over trade actions

- **WHEN** a new trade action is added
- **THEN** the reconciliation registry SHALL require a handler for that action at compile time
- **AND** the API SHALL NOT build if any trade action lacks a reconciler

#### Scenario: Release reconciliation remains idempotent

- **WHEN** an escrow order's release (`confirm_receipt` or `claim_timeout`) is reconciled while the order is already `released`
- **THEN** the API SHALL leave the order and its trade row unchanged
- **AND** SHALL NOT record a duplicate trade

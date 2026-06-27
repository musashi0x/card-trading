# Capability: marketplace-settlement-contract

> Status: MODIFIED

## ADDED Requirements

### Requirement: Atomic card-for-card barter swap

The settlement contract SHALL provide a two-phase swap mechanism: `propose_swap`
locks the proposer's card tokens into custody; `execute_swap` simultaneously
pulls the counterparty's cards and releases all assets cross-directionally in a
single atomic transaction. Both `cancel_swap` and `decline_swap` return all
locked assets to their original owners.

#### Scenario: Proposer locks cards in custody
- **GIVEN** Alice holds card tokens [A1, A2]
- **WHEN** Alice calls `propose_swap(counterparty=Bob, give=[A1,A2], get=[B1], usdc=50)`
- **THEN** A1 and A2 SHALL be transferred to contract custody
- **AND** a `SwapProposal` SHALL be stored with `status = proposed`
- **AND** a `swap_proposed` event SHALL be emitted with the proposal id

#### Scenario: Counterparty executes and all assets move atomically
- **GIVEN** a `SwapProposal` with `status = proposed`, give=[A1,A2], get=[B1], usdc=50
- **WHEN** Bob calls `execute_swap(proposal_id)`
- **THEN** B1 SHALL be pulled from Bob's account
- **AND** A1 and A2 SHALL be released from custody to Bob
- **AND** B1 SHALL be transferred from custody to Alice
- **AND** 50 USDC shall be pulled from Alice and split: `fee = 50 * fee_bps / 10_000` to platform, remainder to Bob
- **AND** a `swap` event SHALL be emitted
- **AND** if any transfer fails the entire transaction SHALL revert

#### Scenario: Proposer cancels and cards are returned
- **GIVEN** a `SwapProposal` with `status = proposed`
- **WHEN** Alice calls `cancel_swap(proposal_id)` before Bob executes
- **THEN** A1 and A2 SHALL be returned from custody to Alice
- **AND** the proposal status SHALL be `cancelled`

#### Scenario: Counterparty declines and cards are returned
- **GIVEN** a `SwapProposal` with `status = proposed`
- **WHEN** Bob calls `decline_swap(proposal_id)`
- **THEN** A1 and A2 SHALL be returned from custody to Alice
- **AND** the proposal status SHALL be `declined`

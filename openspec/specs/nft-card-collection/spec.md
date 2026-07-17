# nft-card-collection

## Purpose

Operate a single global NFT collection contract that holds every card copy as a unique, owner-minted token with per-token royalty data, giving the platform and settlement contract a standard, trustline-free interface for card custody and transfer.

## Requirements

### Requirement: Global card collection contract

The platform SHALL operate a single NFT collection contract implementing the
standard non-fungible token interface (OpenZeppelin Stellar `non_fungible`
Base variant), holding every card copy as a unique token.

#### Scenario: Collection is the only card token the marketplace trusts

- **WHEN** the settlement contract is initialized
- **THEN** it SHALL store the collection contract address as configuration
- **AND** all card custody operations SHALL target that collection only

#### Scenario: Standard interface interoperability

- **WHEN** any contract or client interacts with a card copy
- **THEN** `owner_of`, `transfer`, and approval semantics SHALL follow the
  standard non-fungible token interface

### Requirement: Owner-restricted sequential minting

Only the platform owner account SHALL mint tokens, and token ids SHALL be
assigned sequentially by the collection.

#### Scenario: Platform mints card copies

- **WHEN** the platform mints `supply` copies of a new card
- **THEN** the collection SHALL assign `supply` consecutive token ids
- **AND** each token's serial SHALL be its mint order within the card

#### Scenario: Non-owner mint is rejected

- **WHEN** any account other than the collection owner calls `mint`
- **THEN** the call SHALL fail with an authorization error

### Requirement: Per-token royalty registered at mint

The collection SHALL record a creator account and royalty rate per token at
mint time, readable by other contracts.

#### Scenario: Royalty readable by the settlement contract

- **WHEN** a card copy minted with a creator royalty is listed
- **THEN** the settlement contract SHALL be able to read `(creator, bps)` for
  that token from the collection

### Requirement: Trustline-free ownership

Holding a card copy SHALL NOT require any Stellar trustline; ownership is
contract storage.

#### Scenario: Fresh account receives a card

- **WHEN** a card copy is transferred to an account with no prior relationship
  to the collection
- **THEN** the transfer SHALL succeed without any trustline or prior setup by
  the recipient

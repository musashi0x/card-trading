## MODIFIED Requirements

### Requirement: Transaction building for trade actions
The API SHALL build unsigned Stellar transactions for list, cancel, make-offer, withdraw-offer, accept-offer, and buy-now so the client can sign them in the user's wallet. When a contract-call simulation fails with a transient post-write lag — including the Soroban Asset Contract's trustline-missing revert (`Error(Contract, #13)` / "trustline entry is missing") emitted right after a mint+distribute — the API SHALL retry the build before failing, and SHALL surface a persistent failure as an actionable client error rather than an opaque 500.

#### Scenario: Build a make-offer transaction
- **WHEN** a buyer requests to make an offer on a listing
- **THEN** the API SHALL return an unsigned transaction invoking the contract's `make_offer`
- **AND** the API SHALL NOT hold or use the buyer's private key

#### Scenario: Pre-flight validation before building
- **WHEN** building a transaction that requires a trustline or sufficient balance
- **THEN** the API SHALL validate the prerequisite
- **AND** SHALL return a clear, actionable error if it is not met

#### Scenario: List built immediately after minting (Soroban lag)
- **WHEN** building a `list` transaction whose `transfer` simulation reverts with the Soroban Asset Contract trustline-missing error (`Error(Contract, #13)` / "trustline entry is missing") because the seller's just-distributed card balance is not yet visible to the Soroban RPC
- **THEN** the API SHALL treat it as a transient lagging-ledger error and retry the build within its bounded retry window
- **AND** SHALL return the unsigned transaction once the Soroban RPC reflects the trustline

#### Scenario: Seller genuinely lacks the card trustline
- **WHEN** the same simulation error persists after the API exhausts its retries
- **THEN** the API SHALL return a 400 `MISSING_TRUSTLINE`-style error identifying the seller and asset
- **AND** SHALL NOT return an opaque 500 `INTERNAL` error

## ADDED Requirements

### Requirement: Minting rejects the platform issuer as owner
The API SHALL reject a card mint or distribute whose owner is the platform issuer account, because an issuer cannot hold a trustline to an asset it issues and the resulting `changeTrust` is invalid by protocol (`CHANGE_TRUST_SELF_NOT_ALLOWED`).

#### Scenario: Mint requested for the issuer account
- **WHEN** a client requests `/api/cards/mint` (or distribute) with `owner` equal to the configured platform issuer
- **THEN** the API SHALL reject the request with a clear pre-flight error (e.g. `OWNER_IS_ISSUER`) before allocating an asset code, deploying the SAC, or building a trustline
- **AND** SHALL NOT return a trustline for the client to sign

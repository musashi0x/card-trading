## ADDED Requirements

### Requirement: Generated wallet creation during onboarding

The system SHALL let a first-time user with no existing wallet create a brand-new
Stellar classic (`G…`) account from the wallet-connect onboarding entry point,
alongside the existing connect-Freighter and passkey options. The keypair SHALL be
generated client-side and the secret key MUST NOT be transmitted to or stored by
the API.

#### Scenario: First-time user creates a new wallet

- **WHEN** a user with no connected wallet chooses "Create a new wallet" from the
  onboarding/connect entry point
- **THEN** the system SHALL generate a fresh Stellar keypair in the browser
- **AND** the resulting `G…` public key SHALL become the user's address for the
  session
- **AND** the user's secret key SHALL NOT be sent to the API

#### Scenario: Generated account behaves like a connected classic wallet

- **WHEN** a user has created a new wallet via this flow
- **THEN** the connected state SHALL report `walletKind` of `classic`
- **AND** subsequent marketplace actions SHALL build, sign, and submit
  transactions through the same tx-build flow used for a connected Freighter
  account, with no additional onboarding step

### Requirement: On-chain account creation and funding

The system SHALL create and fund the generated account on-chain on Stellar testnet
so that, immediately after onboarding, the account can both **create a card / list**
and **attend an auction** (make an offer / buy) without any additional faucet step.
Funding SHALL deliver: XLM via friendbot (covering the base reserve, trustline/
listing reserves, and per-transaction fees), a USDC trustline, and a starter USDC
balance. The user SHALL NOT need to acquire XLM or USDC beforehand.

#### Scenario: New account is funded with XLM on creation

- **WHEN** a new wallet keypair has been generated during onboarding
- **THEN** the system SHALL request testnet funding for the new `G…` address
- **AND** on success the account SHALL exist on-chain with a non-zero XLM balance

#### Scenario: USDC trustline is established

- **WHEN** the newly funded account has no USDC trustline
- **THEN** the system SHALL obtain a `change_trust` transaction for USDC, sign it
  with the generated wallet, and submit it
- **AND** after submission the account SHALL hold a USDC trustline

#### Scenario: Starter USDC balance is seeded

- **WHEN** the account exists on-chain and holds a USDC trustline
- **THEN** the system SHALL mint a starter balance of test USDC to the account
- **AND** the account SHALL hold a non-zero USDC balance sufficient to make an
  offer or buy

#### Scenario: Account is ready to create a card or attend an auction

- **WHEN** funding has completed (XLM + USDC trustline + USDC balance)
- **THEN** the connected account SHALL be able to create/list a card and make an
  offer or buy-now without being prompted to visit a separate faucet

#### Scenario: Funding service is unavailable

- **WHEN** any funding step (friendbot, trustline submission, or USDC mint) fails,
  times out, or is rate-limited
- **THEN** the system SHALL surface an actionable, retryable error
- **AND** the user SHALL NOT be shown as fully onboarded
- **AND** the user MAY retry funding for the same generated address

### Requirement: On-chain verification before connect

The system SHALL verify that the generated account exists on-chain before treating
the user as connected, so the user's first marketplace transaction does not fail
with an account-not-found error due to ledger-close latency.

#### Scenario: Connect waits for on-chain existence

- **WHEN** funding has been requested for a newly generated account
- **THEN** the system SHALL poll the ledger (with bounded retries) until the
  account resolves
- **AND** the user SHALL be marked connected only after the account is confirmed
  to exist on-chain

#### Scenario: Account never appears on-chain

- **WHEN** the account cannot be confirmed on-chain within the bounded retry window
- **THEN** the system SHALL surface a retryable error
- **AND** the user SHALL remain disconnected

### Requirement: User record association

The system SHALL ensure a `users` record exists for the generated address so the
new account immediately participates in profiles, stats, and history alongside
connected wallets, without introducing a separate registration step.

#### Scenario: User row ensured on creation

- **WHEN** a new wallet has been created, funded, and verified on-chain
- **THEN** the system SHALL ensure a `users` row keyed by the generated
  `stellar_address`
- **AND** a subsequent `GET /api/profiles/:address` for that address SHALL return
  `200` with a profile (default fields and `memberSince` set)

### Requirement: Secret-key custody and backup

The system SHALL keep the generated wallet non-custodial: the secret key is held
only on the client, and the user MUST be prompted to back it up before they can
authorize transactions. The system SHALL NOT silently restore a generated-wallet
signing session it does not hold the secret for.

#### Scenario: User is prompted to back up the secret

- **WHEN** a new wallet has been created
- **THEN** the system SHALL present the secret key to the user once with an
  explicit backup acknowledgement
- **AND** the user SHALL confirm they have backed it up before authorizing a
  transaction

#### Scenario: Reload without an available secret

- **WHEN** the session is reloaded and no secret for the generated wallet is
  available to the client
- **THEN** the system SHALL NOT present the user as a connected, signable
  generated wallet
- **AND** the user SHALL be treated as disconnected (or prompted to re-import or
  re-create) rather than connected without signing capability

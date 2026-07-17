# marketplace-settlement-contract

## MODIFIED Requirements

### Requirement: List a card into escrow

The settlement contract SHALL accept a listing for a specific card copy
(`token_id`) and take custody of that token via the collection's standard
non-fungible transfer.

#### Scenario: Seller lists a card copy

- **WHEN** a seller calls `list` with a `token_id` and a USDC price
- **THEN** the contract SHALL transfer that token from the seller into its own
  custody via the collection contract
- **AND** SHALL record an open listing referencing the seller, token id, and
  price

#### Scenario: Listing requires the seller to own the copy

- **WHEN** an account calls `list` for a token it does not own
- **THEN** the collection transfer SHALL fail and no listing SHALL be created

### Requirement: Create an auction listing in the contract

Auctions SHALL reference a specific card copy (`token_id`), escrowed via the
collection's standard non-fungible transfer.

#### Scenario: Auction created and card copy escrowed

- **WHEN** a seller calls `create_auction` with a valid `token_id`, start
  price, reserve price, and duration
- **THEN** the contract SHALL transfer that token into its own custody
- **AND** SHALL record an open auction with
  `ends_at = ledger.timestamp() + duration`
- **AND** SHALL emit `(Symbol::new("auction_created"), auction_id)` with a
  payload carrying `token_id` in place of the former `card_token`

### Requirement: Listing binds the card's royalty at list time

The settlement contract SHALL read the token's creator and royalty rate from
the collection contract when a listing or auction is created and store that
snapshot on it, so settlement reads immutable economics that later royalty
changes cannot alter.

#### Scenario: Listing snapshots the royalty

- **WHEN** a seller lists a card copy whose token has a registered royalty
- **THEN** the contract SHALL store the creator and royalty rate on the open
  listing
- **AND** later royalty changes on the collection SHALL NOT affect the
  already-open listing

#### Scenario: Token without a royalty

- **WHEN** a card copy with a zero royalty rate is listed
- **THEN** the contract SHALL treat its creator as the seller and settle as a
  two-way split

## REMOVED Requirements

### Requirement: Register a creator royalty per card

**Reason**: Royalty data moves into the collection contract (per-token,
registered at mint via the Royalties extension). The settlement contract's
`set_royalty` / `get_royalty_view` registry and its admin surface are
deleted.

**Migration**: The list-time snapshot invariant is preserved; the snapshot's
source becomes the collection's royalty view instead of the internal
registry.

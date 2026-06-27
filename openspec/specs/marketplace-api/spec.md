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
The API SHALL expose endpoints to build unsigned Soroban transactions for each supported marketplace action. Supported actions SHALL include the fixed-price trade actions (`list`, `cancel_listing`, `make_offer`, `withdraw_offer`, `accept_offer`, `buy_now`, `purchase_escrow`, `mark_shipped`, `confirm_receipt`, `claim_timeout`, `dispute`) AND the four auction actions (`create_auction`, `place_bid`, `settle_auction`, `cancel_auction`) AND the four barter swap actions (`propose_swap`, `execute_swap`, `cancel_swap`, `decline_swap`). Each endpoint SHALL return wallet-signable XDR with no key custody. Pre-flight validation SHALL be performed before building any transaction that requires a trustline or sufficient balance.

#### Scenario: Build a make-offer transaction
- **WHEN** a buyer requests to make an offer on a listing
- **THEN** the API SHALL return an unsigned transaction invoking the contract's `make_offer`
- **AND** the API SHALL NOT hold or use the buyer's private key

#### Scenario: Pre-flight validation before building
- **WHEN** building a transaction that requires a trustline or sufficient balance
- **THEN** the API SHALL validate the prerequisite
- **AND** SHALL return a clear, actionable error if it is not met

#### Scenario: List built immediately after minting (Soroban lag)
- **WHEN** a seller requests to list a card immediately after minting, before the Soroban ledger has caught up
- **THEN** the API SHALL return the unsigned list transaction (the card will be available by the time it is submitted)
- **AND** SHALL NOT reject solely on the basis of the Soroban ledger lag

#### Scenario: Seller genuinely lacks the card trustline
- **WHEN** a seller requests to list a card they do not hold
- **THEN** the API SHALL return a pre-flight error indicating the missing balance

### Requirement: Chain indexer reconciles state to Postgres
The API SHALL run an indexer that reconciles on-chain listing, offer, settlement, and swap state into the Postgres mirror, treating the chain as the source of truth, and SHALL record the creator royalty distributed at settlement and the fee distributed on swap cash legs.

#### Scenario: Settlement reflected after a trade
- **WHEN** a trade settles on-chain
- **THEN** the indexer SHALL update the listing to sold, the offer to settled, and record a trade row with the settlement transaction hash, platform fee, and creator royalty amount

#### Scenario: Reconcile on action
- **WHEN** a user completes a contract action
- **THEN** the API SHALL reconcile the affected records from chain state shortly afterward
- **AND** the chain state SHALL take precedence over any prior DB state

#### Scenario: Swap settlement indexed to trades
- **GIVEN** a `swap` event is emitted on-chain
- **THEN** the indexer SHALL write a `trades` row with `proposer`, `counterparty`, give/get card ids, `cash_usdc`, `fee_usdc`, `swap_tx_hash`, and `settled_at`
- **AND** SHALL update the corresponding `trade_proposals` row to `status = accepted`

### Requirement: Trade history with verifiable references
The API SHALL expose trade history where each settled trade includes the on-chain settlement transaction hash and the full fund distribution. The endpoint SHALL accept an optional `account` query parameter; when supplied, only trades where that address is the buyer or the seller SHALL be returned.

#### Scenario: View a settled trade
- **WHEN** a client requests trade history
- **THEN** each trade SHALL include buyer, seller, price, platform fee, creator royalty amount, and a settlement transaction hash usable to look it up on a block explorer

#### Scenario: Filter trade history to a wallet

- **WHEN** a client requests `GET /api/trades?account=<address>`
- **THEN** the API SHALL return only trades where the given address is the buyer or the seller
- **AND** the response shape SHALL be identical to the unfiltered response

#### Scenario: Omitting the account parameter returns all trades

- **WHEN** a client requests `GET /api/trades` without an `account` parameter
- **THEN** the API SHALL return all settled trades ordered newest-first, unchanged from existing behavior

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

### Requirement: Minting rejects the platform issuer as owner
The API SHALL reject a card mint or distribute whose owner is the platform issuer account, because an issuer cannot hold a trustline to an asset it issues and the resulting `changeTrust` is invalid by protocol (`CHANGE_TRUST_SELF_NOT_ALLOWED`).

#### Scenario: Mint requested for the issuer account
- **WHEN** a client requests `/api/cards/mint` (or distribute) with `owner` equal to the configured platform issuer
- **THEN** the API SHALL reject the request with a clear pre-flight error (e.g. `OWNER_IS_ISSUER`) before allocating an asset code, deploying the SAC, or building a trustline
- **AND** SHALL NOT return a trustline for the client to sign

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

### Requirement: Watchlist CRUD endpoints

The API SHALL expose three endpoints for managing a wallet's watchlist:
`GET /api/watchlist?account=<address>` returns the current watchlist with full
listing + card data; `POST /api/watchlist` adds a listing; `DELETE
/api/watchlist/:listingId?account=<address>` removes it. All three use the wallet
address as the only identity token (no JWT), matching the pattern of
`GET /api/orders?account=…`. Write endpoints SHALL validate the listing exists
before inserting. Duplicate inserts SHALL use `ON CONFLICT DO NOTHING`.

#### Scenario: Fetch the watchlist for a connected wallet
- **WHEN** a client issues `GET /api/watchlist?account=<address>`
- **THEN** the API SHALL return all watchlist entries for that account where the
  corresponding listing is still `open`, joined with listing and card data,
  ordered by `watchlist.created_at DESC`

#### Scenario: Add a listing to the watchlist
- **WHEN** a client issues `POST /api/watchlist` with `{ account, listingId }`
- **THEN** the API SHALL insert a `watchlist` row for the pair and return `201`
- **AND** if the row already exists the API SHALL return `200` without error
- **AND** if the `listingId` does not exist the API SHALL return `404`

#### Scenario: Remove a listing from the watchlist
- **WHEN** a client issues `DELETE /api/watchlist/:listingId?account=<address>`
- **THEN** the API SHALL delete the matching row (if it exists) and return `200`

#### Scenario: Watchlist rows deleted when a listing closes
- **WHEN** the indexer marks a listing as `sold` or `cancelled`
- **THEN** all `watchlist` rows for that `listing_id` SHALL be deleted in the
  same DB transaction as the status update

### Requirement: Retrieve and update a user profile by Stellar address

The API SHALL expose `GET /api/profiles/:address` and `PUT /api/profiles/:address`
following the same Express Router pattern as the existing `trades` and `catalog`
routes. The GET endpoint creates a `users` row with null optional fields if one
does not yet exist, so the web client never receives a 404 for a known wallet.

#### Scenario: GET returns profile for a connected wallet

- **WHEN** a client sends `GET /api/profiles/G…ABC`
- **THEN** the API SHALL return `200` with a JSON object matching
  `{ stellarAddress, displayName, bio, location, website, avatarUrl, memberSince }`

#### Scenario: PUT persists profile edits

- **WHEN** a client sends `PUT /api/profiles/G…ABC` with a valid body
- **THEN** the API SHALL upsert the `users` row and return `200` with the
  updated profile; no other rows SHALL be modified

#### Scenario: GET for an unknown address auto-creates the row

- **WHEN** a client sends `GET /api/profiles/G…BRAND_NEW` for an address not yet in `users`
- **THEN** the API SHALL insert a row with `stellar_address = G…BRAND_NEW` and
  all optional fields null, then return `200` — not `404`

### Requirement: Profile stats endpoint

The API SHALL expose `GET /api/profiles/:address/stats` that returns aggregate
statistics derived from `trades`, `listings`, and `reviews` rows without
materialising them in the `users` table.

#### Scenario: Stats returned for an active trader

- **WHEN** a client calls `GET /api/profiles/G…ABC/stats`
- **THEN** the API SHALL return `200` with
  `{ collectionValueUsdc, cardsOwned, cardsSold, sellerRating, winRate, achievements }`
  where each value is computed from live Postgres rows

#### Scenario: Stats endpoint never returns 404

- **WHEN** a client calls the stats endpoint for any address (even one with no activity)
- **THEN** the API SHALL return `200` with zero/null values rather than `404`

### Requirement: Reviews endpoints

The API SHALL expose `GET /api/profiles/:address/reviews` (returns all reviews
for the address, newest first) and `POST /api/profiles/:address/reviews` (inserts
a new review, enforcing one review per reviewer per trade and counterparty-only
writes).

#### Scenario: List reviews for a seller

- **WHEN** a client calls `GET /api/profiles/G…SELLER/reviews`
- **THEN** the API SHALL return `200` with an array of
  `{ id, reviewerAddress, rating, text, createdAt }` ordered by `created_at DESC`

#### Scenario: Post review — happy path

- **WHEN** a valid counterparty POSTs `{ tradeId, rating, text }`
- **THEN** the API SHALL return `201` with the new review row

#### Scenario: Post review — duplicate rejected

- **WHEN** a reviewer posts for a `tradeId` they have already reviewed
- **THEN** the API SHALL return `409` with code `DUPLICATE_REVIEW`

### Requirement: Portfolio valuation endpoint
The API SHALL expose `GET /api/portfolio?account=G…|C…` that returns a
connected wallet's portfolio: holdings with per-card value and cost basis, totals,
allocation by rarity, best/worst performer, and a 12-month value-history series.
The endpoint SHALL reuse the `filterHeldCards` holdings-resolution layer and
derive all data from the existing `cards`, `listings`, and `trades` tables without
a dedicated snapshot store.

#### Scenario: Portfolio for a wallet with holdings
- **WHEN** `GET /api/portfolio?account=G…` is called for an account with on-chain
  card holdings
- **THEN** the API SHALL return each held card with `value`, `costBasis`,
  `costBasisKnown`, and `valuedAt` (one of `"trade"`, `"listing"`, or `null`)
- **AND** SHALL include `totalValue`, `totalCost`, `unrealizedGain`, a
  `rarity` allocation array, `bestPerformer`, `worstPerformer`, and a `history`
  array of 12 monthly `{ month, value }` entries

#### Scenario: Portfolio for an empty or unknown wallet
- **WHEN** the account holds no cards or does not exist on-chain
- **THEN** the API SHALL return an empty holdings array with all numeric totals
  as `0` and all 12 history entries as `0`, with status `200`

#### Scenario: Portfolio rejects an invalid account address
- **WHEN** `GET /api/portfolio` is called with an address that does not match
  the Stellar address pattern (`G…` / `C…` + 55 chars)
- **THEN** the API SHALL return `400` with `code: "INVALID_ACCOUNT"`
- **AND** SHALL NOT make any Horizon or RPC calls

#### Scenario: Holdings include cards currently open-listed
- **WHEN** the account has a card with an open listing (the card is not yet sold)
- **THEN** that card SHALL appear in the holdings array with `listed: true`
- **AND** it SHALL be valued using the same valuation waterfall as all other
  holdings

### Requirement: Leaderboard aggregation endpoint

The API SHALL expose `GET /api/leaderboard` accepting `board` (`collectors` |
`sellers` | `traders`), optional `account` (Stellar address), and optional
`limit` (integer 1–100, default 50). The response SHALL include a `rows` array
of ranked entries for the requested board and an `ownStanding` object for the
requesting account (or `null` when `account` is omitted). Board rows SHALL be
cached in-process for 5 minutes keyed on `(board, limit)`; the `ownStanding`
lookup SHALL NOT be cached. Metric definitions follow the `marketplace-leaderboard`
capability spec. A missing `board` parameter SHALL return HTTP 400.

#### Scenario: Fetch the collectors board

- **WHEN** a client requests `GET /api/leaderboard?board=collectors&limit=10&account=G…`
- **THEN** the API SHALL return HTTP 200 with `{ rows: [...], ownStanding: {...}, ratingAvailable: null }`
- **AND** `rows` SHALL contain at most 10 entries ranked by `collectionValue` descending
- **AND** `ownStanding` SHALL reflect the requesting account's season collection value and rank

#### Scenario: Missing board parameter returns 400

- **WHEN** a client calls `GET /api/leaderboard` without a `board` parameter
- **THEN** the API SHALL return HTTP 400 with `{ error: "board: Required", code: "VALIDATION" }`

#### Scenario: Sellers board with reviews table absent

- **WHEN** a client requests `board=sellers` and the `reviews` table does not exist in Postgres
- **THEN** the API SHALL return HTTP 200 with `ratingAvailable: false`
- **AND** every row SHALL have `avgRating: null`
- **AND** the board SHALL be ranked by `salesVolume90d` normally

#### Scenario: Cache hit serves stale-within-TTL board rows

- **WHEN** the same `(board, limit)` combination is requested a second time within 5 minutes
- **THEN** the API SHALL return the cached `rows` without re-running the aggregation query
- **AND** `ownStanding` SHALL still be freshly computed from Postgres on every request

### Requirement: Transaction building for auction actions
The API SHALL expose build endpoints for the four new auction entrypoints — `create_auction`, `place_bid`, `settle_auction`, and `cancel_auction` — returning unsigned XDR envelopes identical in structure to the existing trade-action build endpoints. The bidder's USDC balance SHALL be pre-flight validated before building a `place_bid` transaction.

#### Scenario: Build a create_auction transaction
- **WHEN** a seller requests to build a `create_auction` transaction with card, start_price, reserve_price, and duration
- **THEN** the API SHALL return an unsigned transaction invoking the contract's `create_auction`
- **AND** SHALL pre-flight that the seller holds the card asset

#### Scenario: Build a place_bid transaction
- **WHEN** a bidder requests to build a `place_bid` transaction for an auction
- **THEN** the API SHALL return an unsigned transaction invoking the contract's `place_bid`
- **AND** SHALL pre-flight that the bidder holds at least the bid amount in USDC

#### Scenario: Build a settle_auction transaction
- **WHEN** any caller requests to build a `settle_auction` transaction for an expired auction
- **THEN** the API SHALL return an unsigned transaction invoking `settle_auction`

#### Scenario: Build a cancel_auction transaction
- **WHEN** a seller requests to build a `cancel_auction` transaction
- **THEN** the API SHALL return an unsigned transaction invoking `cancel_auction`

### Requirement: Auction state and bid history endpoints
The API SHALL expose REST endpoints to retrieve auction state and the full bid history for an auction. Bid history SHALL be paginated. Auctions SHALL be queryable alongside open listings in the catalog response.

#### Scenario: Fetch bid history for an auction
- **WHEN** a client fetches `GET /auctions/:auctionId/bids`
- **THEN** the API SHALL return a paginated list of bid rows ordered by amount descending (or time ascending), each carrying bidder address, amount, timestamp, and whether the bid was outbid

#### Scenario: Fetch open auctions in the catalog
- **WHEN** a client fetches open listings
- **THEN** the API SHALL include open auctions in the response, each carrying `ends_at`, `high_bid`, `high_bidder`, `start_price`, and `reserve_price` (reserve may be omitted or masked in the response per product decision)

#### Scenario: Fetch a single auction by id
- **WHEN** a client fetches `GET /auctions/:auctionId`
- **THEN** the API SHALL return the full auction record including current high bid, bidder, ends_at, and status

#### Scenario: My bids for a user
- **WHEN** a client fetches `GET /auctions/bids?bidder=<address>`
- **THEN** the API SHALL return all bid rows for that address across all auctions, including the auction's current status, so the my-bids page can distinguish active vs ended vs won

### Requirement: Chain indexer captures auction events
The chain indexer SHALL subscribe to `auction_created`, `bid_placed`, `outbid`, `auction_settled`, and `auction_cancelled` events emitted by the settlement contract, and SHALL reconcile the `auctions` and `bids` Postgres tables accordingly. `auction_settled` events SHALL additionally insert a `trades` row (reusing the existing trade record shape) to keep settlement analytics consistent.

#### Scenario: auction_created event indexed
- **WHEN** the indexer receives an `auction_created` event
- **THEN** it SHALL insert a row into the `auctions` table with the auction id, seller, card_id, start_price, reserve_price, ends_at, and status `open`

#### Scenario: bid_placed event indexed
- **WHEN** the indexer receives a `bid_placed` event
- **THEN** it SHALL insert a row into the `bids` table and update `auctions.high_bid`, `auctions.high_bidder`, and `auctions.ends_at` (in case of anti-snipe extension)

#### Scenario: outbid event marks previous bid as outbid
- **WHEN** the indexer receives an `outbid` event
- **THEN** it SHALL set `bids.outbid_at` on the bid row for the previous high bidder

#### Scenario: auction_settled event reconciles state and inserts a trade
- **WHEN** the indexer receives an `auction_settled` event
- **THEN** it SHALL update `auctions.status = 'settled'`, set `auctions.settle_tx_hash`
- **AND** SHALL insert a `trades` row with buyer, seller, price, fee, royalty, and settle_tx_hash

### Requirement: Barter trade proposal CRUD

The API SHALL expose endpoints to create, list, accept, decline, and cancel barter
trade proposals; build the corresponding Soroban XDR for each action; and relay
passkey-authorised swap transactions.

#### Scenario: Proposer creates a trade proposal
- **WHEN** `POST /api/trade-proposals` is called with valid give/get card ids, counterparty, and optional USDC
- **THEN** the API SHALL build a `propose_swap` XDR, return it for signing, and (after relay/submission) record the `trade_proposals` row with `status = proposed`

#### Scenario: Counterparty lists incoming proposals
- **WHEN** `GET /api/trade-proposals?party=<address>` is called
- **THEN** the response SHALL include all proposals where the address is proposer or counterparty, with full card metadata and status

#### Scenario: Counterparty accepts a proposal
- **WHEN** `POST /api/trade-proposals/:id/accept` is called by the counterparty
- **THEN** the API SHALL build an `execute_swap` XDR, return it for signing, and (after relay/submission) update the proposal to `status = accepted` and write a `trades` row

#### Scenario: Counterparty declines a proposal
- **WHEN** `POST /api/trade-proposals/:id/decline` is called by the counterparty
- **THEN** the API SHALL build and submit a `decline_swap` transaction returning the proposer's cards, then update the proposal to `status = declined`

#### Scenario: Proposer cancels a proposal
- **WHEN** `POST /api/trade-proposals/:id/cancel` is called by the proposer
- **THEN** the API SHALL build and submit a `cancel_swap` transaction returning the proposer's cards, then update the proposal to `status = cancelled`

#### Scenario: Expired proposals are swept by the API cron
- **WHEN** the expiry cron finds proposals with `expires_at < now` and `status = proposed`
- **THEN** the cron SHALL submit `cancel_swap` for each and update those rows to `status = expired`


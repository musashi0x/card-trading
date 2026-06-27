## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Transaction building for trade actions
The API SHALL expose endpoints to build unsigned Soroban transactions for each supported marketplace action. Supported actions SHALL include the fixed-price trade actions (`list`, `cancel_listing`, `make_offer`, `withdraw_offer`, `accept_offer`, `buy_now`, `purchase_escrow`, `mark_shipped`, `confirm_receipt`, `claim_timeout`, `dispute`) AND the four new auction actions (`create_auction`, `place_bid`, `settle_auction`, `cancel_auction`). Each endpoint SHALL return wallet-signable XDR with no key custody. Pre-flight validation SHALL be performed before building any transaction that requires a trustline or sufficient balance.

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

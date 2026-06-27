## ADDED Requirements

### Requirement: Real auction bid flow
The web app SHALL allow a connected user to place a bid on an auction listing by building, signing, and submitting a `place_bid` transaction. The bid flow SHALL replace the previous simulated `confirmBid`/`scheduleRival` flow entirely. The UI SHALL pre-fill the minimum next bid based on the current high bid (fetched from the API), allow the user to enter a higher amount, and show a confirmation step before signing.

#### Scenario: User places a bid
- **WHEN** a connected user selects an auction, enters a valid bid amount, and confirms
- **THEN** the app SHALL build and have them sign a `place_bid` transaction
- **AND** on success SHALL refresh the bid history and show the updated high bid

#### Scenario: Bid below current high bid is rejected before signing
- **WHEN** a user enters a bid amount that does not exceed the current high bid
- **THEN** the app SHALL show an inline error and SHALL NOT allow submission

#### Scenario: Live countdown from real ends_at
- **WHEN** an auction card is displayed
- **THEN** the countdown timer SHALL derive from the `ends_at` field returned by the API (not a simulated hash)
- **AND** when an anti-snipe extension occurs the timer SHALL update on the next API poll or WebSocket push

#### Scenario: Expired auction shows settle button
- **WHEN** an auction's `ends_at` has passed and status is still `open`
- **THEN** the app SHALL show a "Settle Auction" button that any user can click to trigger `settle_auction`

### Requirement: Real bid history
The web app SHALL render a live bid history on the auction card detail page, sourced from the API's `GET /auctions/:id/bids` endpoint. The bid history SHALL show each bidder's address (truncated), bid amount, time placed, and whether the bid was outbid.

#### Scenario: Bid history loads from the API
- **WHEN** a user opens an auction card detail page
- **THEN** the app SHALL fetch and render the bid history from the real bids API endpoint
- **AND** SHALL NOT render mock bid data

#### Scenario: Outbid bids are visually distinguished
- **WHEN** a bid in the history has been outbid
- **THEN** the app SHALL display it with a visual treatment (e.g., strikethrough or muted style) distinguishing it from the current high bid

#### Scenario: Empty bid history
- **WHEN** an auction has no bids
- **THEN** the app SHALL display "No bids yet" rather than mock bid data

#### Scenario: Bid history refreshes after a new bid
- **WHEN** the user successfully places a bid
- **THEN** the app SHALL re-fetch and re-render the bid history to include the new bid

### Requirement: My bids page fed by real bids
The web app's my-bids page SHALL query the real bids API (`GET /auctions/bids?bidder=<address>`) and display all bids placed by the connected user, grouped or sorted by auction status (active, won, ended-lost).

#### Scenario: My bids shows real on-chain bids
- **WHEN** a connected user navigates to the my-bids page
- **THEN** the app SHALL fetch their bids from the API
- **AND** SHALL display each bid with the auction name, their bid amount, the current high bid, and the auction status

#### Scenario: Won auction is highlighted
- **WHEN** the user is the `high_bidder` on a settled auction
- **THEN** the my-bids page SHALL display the auction as "Won" with the settlement details

#### Scenario: No bids state
- **WHEN** the connected user has placed no bids
- **THEN** the my-bids page SHALL display an appropriate empty state

#### Scenario: Outbid notification
- **WHEN** the user has been outbid on an active auction
- **THEN** the my-bids page SHALL surface this clearly (e.g., "You've been outbid — current high bid: $X")

### Requirement: Create an auction listing from the sell flow
The web app SHALL allow a seller to create an auction listing (in addition to fixed-price listings) by entering a start price, optional reserve price, and auction duration. The flow SHALL build and submit a `create_auction` transaction.

#### Scenario: Seller creates an auction
- **WHEN** a seller chooses "Auction" as listing type, enters start price, reserve, and duration, and confirms
- **THEN** the app SHALL build and have them sign a `create_auction` transaction
- **AND** on success SHALL show the auction as active with the correct countdown timer

#### Scenario: Fixed-price and auction listing types are independently available
- **WHEN** a seller opens the "Sell" form
- **THEN** the app SHALL offer both "Fixed price" and "Auction" as listing type options

#### Scenario: Auction creation with invalid duration is rejected
- **WHEN** a seller enters a duration of zero or leaves the duration field blank
- **THEN** the app SHALL show a validation error and SHALL NOT submit

#### Scenario: Auction card is visually distinguished from fixed-price listing
- **WHEN** an auction card is rendered on the browse grid
- **THEN** it SHALL display the live countdown and current bid rather than a static "Buy Now" price

## REMOVED Requirements

### Requirement: Simulated auction bid flow
**Reason**: Replaced by the real on-chain bid flow (`place_bid` transaction + real bid history from API). The frontend simulation (`confirmBid`, `scheduleRival`, `openBid` in `TopDeckProvider.tsx` and `simulatedEndsAt`/mock `bids[]` in `lib.ts`) is completely removed.
**Migration**: Users interact with `place_bid` through the new real bid UI. The `TopCard.endsAt` field now derives from `auctions.ends_at` returned by the API instead of from the deterministic hash `simulatedEndsAt`. The `TopCard.bids` array is populated by the real bids API endpoint instead of mock seed data.

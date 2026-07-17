## Purpose

Let users connect a Stellar wallet, browse and search cards, list cards for sale, make and withdraw offers, buy or accept atomically, and inspect settled trades.
## Requirements
### Requirement: Wallet connection
The web app SHALL let a user connect a Stellar wallet (Freighter) and display their connected address.

#### Scenario: User connects a wallet
- **WHEN** a user clicks connect and approves in the wallet
- **THEN** the app SHALL display the connected Stellar address
- **AND** subsequent trade actions SHALL be signed through that wallet
- **AND** the watchlist SHALL load from the server for the connected address

#### Scenario: Wallet not installed
- **WHEN** a user attempts to connect without the wallet available
- **THEN** the app SHALL show guidance on installing the wallet

### Requirement: Browse and search cards
The web app SHALL let users browse open listings and search cards by name, set, or rarity.
The app SHALL NEVER display fabricated or demo listings as a fallback — all displayed listings MUST originate from the live API.

**Reason for modification:** The previous requirement implied that the grid would always show listings, but the implementation silently filled an empty or errored response with 8 hardcoded demo cards (`mockCards()`). The requirement is extended to explicitly forbid fabricated data and to mandate distinct loading, error, and empty states.

**Migration:** Remove `mockCards()` from `lib.ts` and its call sites in `TopDeckProvider.tsx`. Ensure the grid renders the empty and error states described in the scenarios below.

#### Scenario: Browse the marketplace
- **WHEN** a user opens the marketplace and the API returns open listings
- **THEN** the app SHALL display those listings with card image, name, rarity, and price in test USDC

#### Scenario: Search for a card
- **WHEN** a user enters a search term
- **THEN** the app SHALL display matching cards and their open listings

#### Scenario: No open listings
- **WHEN** a user opens the marketplace and the API returns successfully with zero open listings and no active filters
- **THEN** the app SHALL display an honest empty state (e.g. "No open listings yet") with a call-to-action to list a card
- **AND** SHALL NOT display any fabricated or demo card data

#### Scenario: API unreachable
- **WHEN** a user opens the marketplace and the listings API call fails
- **THEN** the app SHALL display a distinct error state informing the user that listings could not be loaded
- **AND** SHALL provide a Retry action that re-fetches the listings
- **AND** SHALL NOT display any fabricated or demo card data

### Requirement: List a card for sale
The web app SHALL let a connected seller list a card they own at a stated price, signing the listing transaction in their wallet.

#### Scenario: Seller lists a card
- **WHEN** a connected seller selects an owned card, sets a price, and confirms
- **THEN** the app SHALL have them sign the `list` transaction
- **AND** on success SHALL show the card as an open listing

### Requirement: Make and withdraw offers
The web app SHALL let a connected buyer make an offer on a listing and withdraw an unaccepted offer, signing each action in their wallet.

#### Scenario: Buyer makes an offer
- **WHEN** a connected buyer enters an offer amount and confirms
- **THEN** the app SHALL have them sign the `make_offer` transaction
- **AND** SHALL show the offer as open with funds held in escrow

#### Scenario: Buyer withdraws an offer
- **WHEN** a buyer withdraws an unaccepted offer
- **THEN** the app SHALL have them sign the `withdraw_offer` transaction
- **AND** on success SHALL show the escrowed funds returned

### Requirement: Accept an offer and buy now
The web app SHALL let a seller accept an offer and let a buyer buy at the asking price, each settling the trade atomically. Buy-now SHALL submit a real on-chain settlement for every wallet type — classic and passkey — and SHALL NOT present a purchase as complete unless the settlement transaction has confirmed.

#### Scenario: Seller accepts an offer
- **WHEN** a seller accepts an open offer and confirms
- **THEN** the app SHALL have them sign the `accept_offer` transaction
- **AND** on success SHALL show the trade as settled

#### Scenario: Buyer buys now
- **WHEN** a buyer chooses buy-now on a listing and confirms
- **THEN** the app SHALL have them sign the `buy_now` transaction
- **AND** on success SHALL show the trade as settled and the card transferred

#### Scenario: Classic wallet buys now with USDC
- **WHEN** a buyer on a classic wallet with USDC as the source asset confirms buy-now
- **THEN** the app SHALL build, sign, and submit the `buy_now` settlement transaction via the buy-now API
- **AND** SHALL show success only after the settlement transaction confirms
- **AND** SHALL NOT mark the card as owned without a confirmed settlement transaction

#### Scenario: Buy-now reports a failed settlement
- **WHEN** the `buy_now` settlement transaction fails or is rejected
- **THEN** the app SHALL surface the failure to the buyer
- **AND** SHALL NOT show the card as owned

### Requirement: Verifiable trade history
The web app SHALL show trade history with the full settlement breakdown — covering both cash trades and card barter swaps — and a link to inspect each settlement on a block explorer.

#### Scenario: Inspect a settled trade
- **WHEN** a user views a settled cash trade
- **THEN** the app SHALL display price, platform fee, creator royalty, the seller's net proceeds, and a link opening the settlement transaction on a block explorer

#### Scenario: Primary sale shows no royalty
- **WHEN** a user views a settled trade where the seller was the card's creator
- **THEN** the app SHALL show the creator royalty as zero (or omit the royalty line)
- **AND** SHALL display the seller's proceeds as price minus the platform fee

#### Scenario: Accepted swap shown in trade history
- **GIVEN** a swap settled with `swap_tx_hash`
- **WHEN** the user opens Trade History
- **THEN** the swap row SHALL show the give-side cards, get-side cards, USDC sweetener (if any), platform fee, and a link to the on-chain swap transaction

### Requirement: Listings disclose the creator royalty
The web app SHALL disclose a card's creator royalty on its listing so a buyer or seller sees the royalty before trading.

#### Scenario: Royalty shown on a listing
- **WHEN** a user views a listing for a card with a non-zero creator royalty
- **THEN** the app SHALL display the creator royalty rate
- **AND** SHALL indicate the royalty is paid to the card's creator on sale

### Requirement: Pay for a card with any held asset

The web app SHALL let a buyer choose a source asset other than USDC when buying a
card or making an offer, display a live conversion quote before they commit, and
sequence the optional conversion ahead of the unchanged settlement step. The
source-asset picker SHALL default to USDC so existing behavior is preserved. When
the conversion has committed but the subsequent settlement does not complete, the
app SHALL communicate the buyer's residual USDC balance and a way to retry rather
than presenting the purchase as successful.

#### Scenario: Buyer selects a non-USDC asset and sees a quote

- **WHEN** a buyer opens the buy or offer modal and selects a source asset such
  as XLM
- **THEN** the app SHALL show a live quote ("You pay ~X XLM → seller receives Y
  USDC") including the slippage cap before the buyer confirms

#### Scenario: Buyer converts then settles

- **WHEN** the buyer confirms a purchase funded by a non-USDC asset
- **THEN** the app SHALL prompt the buyer to sign the path-payment conversion
  first, and on its confirmation proceed to the existing `buy_now` /
  `accept_offer` settlement step
- **AND** SHALL show success only after the settlement step confirms

#### Scenario: Settlement fails after the conversion committed

- **WHEN** the path-payment conversion has confirmed but the subsequent `buy_now`
  settlement fails (for example the listing was sold first, or a transient error)
- **THEN** the app SHALL NOT present the purchase as successful
- **AND** SHALL inform the buyer they now hold the converted USDC
- **AND** SHALL offer to retry the settlement or apply the held USDC to another
  card, distinguishing a permanently closed listing from a retryable error

#### Scenario: USDC trustline prompt

- **WHEN** the API reports the buyer lacks a USDC trustline
- **THEN** the app SHALL prompt the buyer to sign a `change_trust` transaction
  before the conversion

#### Scenario: Buyer already holds enough USDC

- **WHEN** the buyer's USDC balance already covers the amount
- **THEN** the app SHALL skip the conversion step and go straight to settlement,
  unchanged from today's flow

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

### Requirement: Trade history view

The web app SHALL provide a dedicated trade-history page at `/trades` that renders settled trades returned by `useTrades()`, displaying the full settlement split and a block-explorer link for each trade.

#### Scenario: View the global trade feed

- **WHEN** any user (connected or not) navigates to the History page
- **THEN** the app SHALL display all settled trades ordered newest-first, each showing buyer, seller, gross price, platform fee, creator royalty, seller net, settle time, and a link to the settlement transaction on the block explorer

#### Scenario: Filter to my trades

- **WHEN** a connected wallet holder activates the "My trades" toggle
- **THEN** the app SHALL refetch trades filtered to that wallet address as buyer or seller
- **AND** SHALL hide trades that do not involve the connected wallet

#### Scenario: Empty state

- **WHEN** no settled trades exist (or none match the active filter)
- **THEN** the app SHALL display a clear empty-state message rather than a blank or errored page

#### Scenario: History nav entry

- **WHEN** any page in the marketplace is active
- **THEN** the top nav SHALL include a "History" link that navigates to `/trades`
- **AND** the link SHALL be visually marked active when the current pathname is `/trades`

### Requirement: Heart toggle reflects persisted watchlist state

The heart icon on each `CardTile` SHALL reflect the server-backed watchlist state
for the connected wallet. The toggle SHALL feel instant via optimistic UI and roll
back on error. When no wallet is connected, tapping the heart SHALL invoke the
wallet connect flow rather than silently no-op.

#### Scenario: Connected wallet watches a listing
- **WHEN** a connected wallet taps the heart on an open listing
- **THEN** the heart flips to active immediately (optimistic)
- **AND** `POST /api/watchlist` is called in the background
- **AND** on success the server-backed watchlist reflects the new entry

#### Scenario: Connected wallet un-watches a listing
- **WHEN** a connected wallet taps an active heart
- **THEN** the heart reverts to inactive immediately (optimistic)
- **AND** `DELETE /api/watchlist/:listingId` is called in the background
- **AND** on API error the heart is restored to its prior state

#### Scenario: No wallet connected — tap prompts to connect
- **WHEN** a visitor without a connected wallet taps the heart
- **THEN** the app SHALL invoke the wallet connect flow
- **AND** the heart SHALL NOT flip to watched

#### Scenario: Watchlist reloads correctly after page refresh
- **WHEN** a connected wallet reloads the page
- **THEN** the heart icons on watched listings SHALL reflect the persisted state
  fetched from `GET /api/watchlist?account=<address>`

### Requirement: My-bids Watchlist section uses persisted data

The "Watchlist" grid in the My-bids Bidding tab SHALL be populated from the
server-backed `useWatchlist` query rather than from local React state. When no
wallet is connected, the section SHALL show a prompt to connect instead of an
empty grid.

#### Scenario: Watchlist grid shows persisted entries
- **WHEN** a connected wallet opens the My-bids / Bidding tab
- **THEN** the Watchlist section SHALL display all listings the wallet is watching
  as fetched from `GET /api/watchlist?account=<address>`

#### Scenario: Empty watchlist shows empty state
- **WHEN** a wallet has no watchlist entries
- **THEN** the Watchlist section SHALL be hidden or show an empty-state prompt

#### Scenario: Not-connected watchlist shows connect prompt
- **WHEN** a visitor opens My-bids without a connected wallet
- **THEN** the Watchlist section SHALL display a prompt to connect a wallet
- **AND** SHALL NOT display an empty grid without context

#### Scenario: Closed listing disappears from Watchlist grid
- **WHEN** a listing in the wallet's watchlist closes (sold or cancelled)
- **THEN** on the next query refresh the listing SHALL no longer appear in the
  Watchlist grid

### Requirement: Profile page displays real persisted data

The `/profile` page SHALL fetch the connected wallet's profile from
`GET /api/profiles/:address` and stats from `GET /api/profiles/:address/stats`
via TanStack Query hooks, replacing all static panel data. The static
`PROFILE_STATS`, `PROFILE_ACHIEVEMENTS`, `PROFILE_ACTIVITY`, and `PROFILE_REVIEWS`
constants from `panels.ts` SHALL NOT be imported or rendered.

#### Scenario: Connected user views their profile

- **WHEN** a user with a connected wallet navigates to `/profile`
- **THEN** the page SHALL display their saved `displayName`, `bio`, `location`,
  `website`, and `memberSince` fetched from the API
- **AND** the stats section SHALL show `collectionValueUsdc`, `cardsOwned`,
  `cardsSold`, `sellerRating`, and `winRate` derived from real trade data

#### Scenario: Profile page shows empty state for a new user

- **WHEN** a freshly connected wallet with no trades or profile edits visits `/profile`
- **THEN** the page SHALL render null/zero values (e.g. "—" for rating) rather
  than the static mock numbers
- **AND** SHALL NOT display `cardwizard_88` or any other hard-coded user data

#### Scenario: Profile shows live reviews from counterparties

- **WHEN** another user has posted a review for this wallet address
- **THEN** the reviews section SHALL display that review with reviewer address,
  star rating, text, and relative timestamp fetched from
  `GET /api/profiles/:address/reviews`

#### Scenario: Achievements reflect real activity

- **WHEN** a user has completed at least one trade as buyer
- **THEN** the `first-win` achievement badge SHALL render as unlocked
- **AND** badges for thresholds not yet reached SHALL render as locked

### Requirement: Profile-edit page persists changes to the API

The `/profile/edit` page SHALL maintain a local form state for editable fields
(displayName, bio, location, website, avatarUrl), call
`PUT /api/profiles/:address` on save, and invalidate the profile query on
success. The in-memory `draft` state and `saveProfile`/`setDraft` helpers in
`TopDeckProvider` SHALL be removed.

#### Scenario: User saves a profile edit

- **WHEN** a user edits their bio on `/profile/edit` and taps Save
- **THEN** the app SHALL call `PUT /api/profiles/:address` with the updated
  fields, navigate back to `/profile`, and the profile page SHALL immediately
  show the new bio without a page reload

#### Scenario: User cancels a profile edit

- **WHEN** a user navigates to `/profile/edit`, makes changes, and taps Cancel
- **THEN** the app SHALL navigate back to `/profile` without calling the API,
  and the profile data SHALL remain unchanged

#### Scenario: Save fails with a network error

- **WHEN** the `PUT /api/profiles/:address` call returns a non-2xx response
- **THEN** the edit page SHALL display an error message and SHALL NOT navigate
  away from `/profile/edit`

### Requirement: Live portfolio page for connected wallets
The web app SHALL replace the static portfolio page with a live view that fetches
real holdings and valuation data from `GET /api/portfolio?account=…` via a
`usePortfolio` query hook, and SHALL disable the fetch until a wallet is
connected.

#### Scenario: Connected wallet with holdings
- **WHEN** a wallet is connected and the user navigates to the portfolio page
- **THEN** the app SHALL fetch and display real holdings, total portfolio value,
  unrealized P&L, value-history chart (12 months), allocation-by-rarity stacked
  bar, best performer stat tile, and the holdings table with per-card cost, value,
  and return percentage

#### Scenario: No wallet connected
- **WHEN** no wallet is connected and the user navigates to the portfolio page
- **THEN** the app SHALL display a prompt to connect a wallet and SHALL NOT
  display portfolio data or trigger any API call

#### Scenario: Wallet connected but no holdings
- **WHEN** a wallet is connected but the account holds no cards
- **THEN** the app SHALL display an empty-state message ("No cards held") instead
  of a holdings table, with totals shown as $0.00

#### Scenario: Card with no market price
- **WHEN** a holding has `valuedAt: null` (no trade history and no open listings)
- **THEN** the app SHALL display "—" in the value column instead of "$0.00"
- **AND** SHALL exclude that holding from P&L percentage computations in the UI

### Requirement: Leaderboard page fetches real ranked data

The leaderboard page (`/leaderboard`) SHALL fetch board data from
`GET /api/leaderboard` via a `useLeaderboard` TanStack Query hook backed by a
typed `api.leaderboard()` method in `@/lib/api.ts`. The hook SHALL accept
`board` and `account` parameters and refetch automatically when either changes.
While data is loading the page SHALL render a skeleton or loading state. On
error the page SHALL surface a user-readable message without crashing.

#### Scenario: Leaderboard loads successfully

- **WHEN** a user navigates to `/leaderboard` with a wallet connected
- **THEN** the page SHALL display the active tab's ranked rows from the API
- **AND** the requesting user's own standing SHALL be shown in the "your rank" panel using `ownStanding`
- **AND** secondary stats (cards held, sales count/rating, flips/ROI) SHALL be rendered per row

#### Scenario: Leaderboard tab switch

- **WHEN** a user clicks a different leaderboard tab (collectors / sellers / traders)
- **THEN** the `useLeaderboard` hook SHALL fire a new request with the updated `board` value
- **AND** the ranked list SHALL update to reflect the new board's data
- **AND** the user's own standing panel SHALL update accordingly

#### Scenario: No wallet connected

- **WHEN** a user views the leaderboard without a connected wallet
- **THEN** `account` SHALL be omitted from the API request
- **AND** `ownStanding` SHALL be `null` and the "your rank" panel SHALL be hidden or show a connect prompt

#### Scenario: API error on leaderboard fetch

- **WHEN** the `GET /api/leaderboard` request fails with a non-2xx status
- **THEN** the page SHALL display an error message and a retry affordance
- **AND** the page SHALL NOT crash or render stale static data

### Requirement: Static leaderboard mocks removed from panels.ts

The following exports SHALL be deleted from
`apps/web/src/components/topdeck/panels.ts`:

- `LB_USERS` (static array of mock leaderboard users)
- `LB_YOU` (static per-tab own-standing record)
- `LB_CFGS` (static per-tab display configuration)
- `LB_SUBTITLE` (static per-tab subtitle strings)

The `LbUser` and `LbTab` type definitions SHALL be moved to
`packages/shared/src/types.ts` as `LeaderboardRow` and `LeaderboardBoard`
respectively (or equivalent names consistent with the API response shape) so
both the API and web share the same type. The leaderboard page SHALL import
these types from `@cardmkt/shared` rather than from `panels.ts`.

#### Scenario: panels.ts no longer exports leaderboard mocks

- **WHEN** a developer imports from `@/components/topdeck/panels`
- **THEN** `LB_USERS`, `LB_YOU`, `LB_CFGS`, and `LB_SUBTITLE` SHALL NOT be resolvable exports
- **AND** the TypeScript compiler SHALL reject any remaining import of those identifiers

#### Scenario: Leaderboard page renders without panels.ts data

- **WHEN** the leaderboard page is compiled after the mock removal
- **THEN** it SHALL import leaderboard data exclusively from the `useLeaderboard` hook
- **AND** it SHALL have no remaining static import of `LB_USERS`, `LB_YOU`, `LB_CFGS`, or `LB_SUBTITLE`

#### Scenario: Shared LeaderboardRow type used across packages

- **WHEN** the API serialises a leaderboard response
- **THEN** the response rows SHALL conform to the `LeaderboardRow` interface from `@cardmkt/shared`
- **AND** the web hook's return type SHALL use the same `LeaderboardRow` interface without duplication

#### Scenario: Remaining panels.ts exports unaffected

- **WHEN** other pages import unrelated exports from `panels.ts` (e.g. portfolio, profile, trade panels)
- **THEN** those imports SHALL continue to resolve without error
- **AND** only the four leaderboard-specific exports SHALL be removed

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

### Requirement: Card barter trade — propose

The web app SHALL allow connected users to propose a peer-to-peer barter trade by
selecting cards from their real on-chain holdings (give side) and from the
counterparty's real on-chain holdings or active listings (get side), with an
optional one-way USDC sweetener. Submitting the proposal SHALL call the API to
lock give-side cards in contract custody and record the proposal. The `MY_CARDS`
static mock, `TradeItem`, `TradeState`, `EMPTY_TRADE` types, and the no-op
`sendTrade`, `openTradePicker`, `addTradeCard` actions SHALL be removed.

#### Scenario: Proposer selects real holdings on the give side
- **GIVEN** a connected user with card tokens on-chain
- **WHEN** the user opens the trade page
- **THEN** the give-side card picker SHALL display only cards returned by `GET /api/cards?owner=<wallet>`
- **AND** no static mock data (`MY_CARDS`) SHALL appear

#### Scenario: Proposer submits a proposal
- **GIVEN** the proposer has selected give-side cards, get-side cards, and a counterparty address
- **WHEN** the user clicks Propose Trade
- **THEN** the app SHALL call `POST /api/trade-proposals`, build and relay the `propose_swap` XDR, and confirm the proposal is pending in the inbox

#### Scenario: Proposal requires counterparty address
- **WHEN** the proposer attempts to submit without entering a counterparty address
- **THEN** the form SHALL show a validation error and prevent submission

### Requirement: Card barter trade — inbox and actions

The web app SHALL display a trade inbox showing all incoming and outgoing proposals
for the connected wallet. Each proposal SHALL show the full card breakdown, USDC
sweetener, status, expiry, and available actions (accept, decline, counter, cancel).

#### Scenario: Incoming proposal appears in inbox
- **GIVEN** a proposal with `counterparty = connected wallet`
- **WHEN** the user opens the Trade Inbox tab
- **THEN** the proposal SHALL appear with the give/get card names, USDC amount, proposer address, status, and time remaining

#### Scenario: Counterparty accepts a proposal
- **GIVEN** an incoming proposal with `status = proposed`
- **WHEN** the counterparty clicks Accept
- **THEN** the app SHALL call `POST /api/trade-proposals/:id/accept`, build and relay `execute_swap` XDR, and confirm both card transfers on success

#### Scenario: Counterparty declines a proposal
- **GIVEN** an incoming proposal with `status = proposed`
- **WHEN** the counterparty clicks Decline
- **THEN** the app SHALL call `POST /api/trade-proposals/:id/decline` and the proposal SHALL move to status `Declined`

#### Scenario: Proposer cancels an outgoing proposal
- **GIVEN** an outgoing proposal with `status = proposed`
- **WHEN** the proposer clicks Cancel
- **THEN** the app SHALL call `POST /api/trade-proposals/:id/cancel` and the locked cards SHALL be returned

### Requirement: Card detail page displays reviews
The card detail page (`/card/[id]`) SHALL display a Reviews section below the existing card information. The section SHALL show the aggregate rating (average stars and total count) and a list of individual reviews (author address truncated, star rating, text body, date).

#### Scenario: Card has reviews
- **WHEN** a user navigates to a card detail page that has at least one review
- **THEN** the page SHALL display the aggregate rating (e.g., "4.2 / 5 — 12 reviews")
- **AND** list each review with truncated author address, star display, body text, and relative date

#### Scenario: Card has no reviews
- **WHEN** a user navigates to a card detail page with no reviews
- **THEN** the page SHALL display "No reviews yet" and, if the user is eligible, a prompt to leave the first review

#### Scenario: Eligible connected user submits a review
- **WHEN** a connected wallet that has owned or traded this card fills in the star rating and optional text and submits
- **THEN** the review form SHALL call `POST /api/cards/:id/reviews`
- **AND** on success SHALL add the new review to the list without a full page reload

#### Scenario: Ineligible connected user views the review section
- **WHEN** a connected wallet that has NOT owned or traded this card views the review section
- **THEN** the page SHALL show the review list but NOT show the submit form
- **AND** SHALL display a tooltip/note explaining why they cannot review

### Requirement: Card detail page displays comments
The card detail page SHALL display a Comments section below the Reviews section. Any authenticated (wallet-connected) user SHALL be able to post a comment from this section.

#### Scenario: Card has comments
- **WHEN** a user navigates to a card detail page that has at least one comment
- **THEN** the page SHALL display comments in chronological order (oldest first)
- **AND** each comment SHALL show truncated author address, body text, and relative date
- **AND** soft-deleted comments SHALL appear as "[comment removed]" with no author

#### Scenario: Card has no comments
- **WHEN** a user navigates to a card detail page with no comments
- **THEN** the page SHALL display "No comments yet"

#### Scenario: Connected user posts a comment
- **WHEN** a connected wallet types a comment and submits
- **THEN** the page SHALL call `POST /api/cards/:id/comments`
- **AND** on success SHALL append the new comment to the list without a full page reload

#### Scenario: Unauthenticated user views comments
- **WHEN** a visitor without a connected wallet views the comments section
- **THEN** the page SHALL display existing comments read-only
- **AND** the comment input SHALL be replaced with a "Connect wallet to comment" prompt

#### Scenario: User deletes their own comment
- **WHEN** a comment author clicks "Delete" on their own comment
- **THEN** the page SHALL call `DELETE /api/cards/:id/comments/:commentId`
- **AND** on success SHALL replace the comment body inline with "[comment removed]"


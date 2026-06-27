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
The web app SHALL let a seller accept an offer and let a buyer buy at the asking price, each settling the trade atomically.

#### Scenario: Seller accepts an offer
- **WHEN** a seller accepts an open offer and confirms
- **THEN** the app SHALL have them sign the `accept_offer` transaction
- **AND** on success SHALL show the trade as settled

#### Scenario: Buyer buys now
- **WHEN** a buyer chooses buy-now on a listing and confirms
- **THEN** the app SHALL have them sign the `buy_now` transaction
- **AND** on success SHALL show the trade as settled and the card transferred

### Requirement: Verifiable trade history
The web app SHALL show trade history with the full settlement breakdown and a link to inspect each settlement on a block explorer.

#### Scenario: Inspect a settled trade
- **WHEN** a user views a settled trade
- **THEN** the app SHALL display price, platform fee, creator royalty, the seller's net proceeds, and a link opening the settlement transaction on a block explorer

#### Scenario: Primary sale shows no royalty
- **WHEN** a user views a settled trade where the seller was the card's creator
- **THEN** the app SHALL show the creator royalty as zero (or omit the royalty line)
- **AND** SHALL display the seller's proceeds as price minus the platform fee

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
source-asset picker SHALL default to USDC so existing behavior is preserved.

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


# web-navigation Specification

## Purpose
TBD - created by archiving change split-topdeck-routes. Update Purpose after archive.
## Requirements
### Requirement: Each screen has a distinct URL

The web app SHALL expose every top-level screen as its own URL route so the address bar reflects the screen currently displayed.

#### Scenario: Navigating to a screen updates the URL

- **WHEN** a user clicks a navigation item (e.g. My Bids, Leaderboard, Portfolio, Orders, Trade, Sell, or Profile)
- **THEN** the app SHALL display that screen
- **AND** the browser URL SHALL change to that screen's distinct path (e.g. `/my-bids`, `/leaderboard`, `/portfolio`, `/orders`, `/trade`, `/sell`, `/profile`)

#### Scenario: Opening a card detail updates the URL

- **WHEN** a user opens a card from the listings
- **THEN** the app SHALL display that card's detail screen
- **AND** the URL SHALL include the card's identifier (e.g. `/card/<id>`)

### Requirement: Routes are deep-linkable and refresh-safe

The web app SHALL render the correct screen when a user loads or refreshes any route URL directly, rather than always returning to the home/browse screen.

#### Scenario: Loading a non-home URL directly

- **WHEN** a user opens or refreshes a non-home route URL (e.g. `/portfolio` or `/card/<id>`)
- **THEN** the app SHALL render that screen's content
- **AND** SHALL NOT redirect the user to the home/browse screen

#### Scenario: Card detail for an unavailable listing

- **WHEN** a user loads a `/card/<id>` URL whose listing is not available (unknown or ended)
- **THEN** the app SHALL render an explicit not-found / ended state for that card
- **AND** SHALL NOT crash or render a blank screen

### Requirement: Browser history navigation works

The web app SHALL participate in browser history so the Back and Forward buttons move between previously visited screens.

#### Scenario: Back button returns to the previous screen

- **WHEN** a user navigates from one screen to another and then presses the browser Back button
- **THEN** the app SHALL display the previously visited screen
- **AND** the URL SHALL return to that screen's path

### Requirement: Active navigation reflects the current route

The web app SHALL derive the highlighted/active navigation item from the current URL so the active state stays correct after deep links, refreshes, and Back/Forward navigation.

#### Scenario: Active tab matches the URL

- **WHEN** the current URL corresponds to a given screen
- **THEN** the app SHALL highlight that screen's navigation item as active
- **AND** SHALL NOT highlight any other navigation item

### Requirement: Session state persists across navigation

The web app SHALL preserve in-session client state that is not tied to a single screen (such as the connected wallet, search query, optimistic bid state, the trade builder, and profile edits in progress) when the user navigates between routes.

#### Scenario: Wallet and session state survive a route change

- **WHEN** a user with a connected wallet navigates from one screen to another
- **THEN** the wallet SHALL remain connected
- **AND** in-progress session state (e.g. an unsent trade builder or unsaved profile draft) SHALL NOT be reset by the navigation


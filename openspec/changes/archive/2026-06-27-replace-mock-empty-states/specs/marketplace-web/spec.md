## MODIFIED Requirements

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

## Why

Card detail pages currently have no social layer — buyers and sellers can't express trust signals or share context about a card's condition, authenticity, or trade history. Adding reviews and comments increases buyer confidence, improves marketplace liquidity, and gives the community a voice on individual cards.

## What Changes

- Introduce a **card review** capability: authenticated users can leave a 1–5 star rating and optional text review on any card they have owned or successfully traded.
- Introduce a **card comments** capability: any authenticated user can post threaded, public comments on a card's detail page.
- Expose new REST endpoints under `/api/cards/:id/reviews` and `/api/cards/:id/comments`.
- Persist reviews and comments in the database with proper ownership, moderation flags, and soft-delete support.
- Display reviews (aggregate rating + list) and comments on the existing card detail page UI.

## Capabilities

### New Capabilities

- `card-reviews`: Allow owners/traders to rate and review a card (1–5 stars + text). Includes aggregate rating display on card detail and listing cards.
- `card-comments`: Allow any authenticated user to post, read, and soft-delete their own public comments on a card detail page.

### Modified Capabilities

- `marketplace-web`: Card detail page gains a Reviews section and a Comments section below the existing card info.

## Impact

- **API**: New routes in the backend (`apps/api`) for reviews and comments CRUD.
- **Database**: Two new tables — `card_reviews` and `card_comments` — with foreign keys to `cards` and `users`.
- **Frontend**: `apps/web/src/app/(marketplace)/card/[id]/page.tsx` extended with review and comment UI components.
- **Auth**: Both capabilities require a connected wallet; write operations gate on wallet address.
- **No breaking changes** to existing endpoints or UI surfaces.

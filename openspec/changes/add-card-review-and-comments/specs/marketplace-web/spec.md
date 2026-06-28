## ADDED Requirements

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

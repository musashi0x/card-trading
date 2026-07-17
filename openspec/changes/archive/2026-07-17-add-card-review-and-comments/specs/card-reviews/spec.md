## ADDED Requirements

### Requirement: Submit a card review
A user who has previously owned or completed a trade for a card SHALL be able to submit a review consisting of a 1–5 star rating and an optional text body (max 1 000 characters).
The system SHALL enforce one review per wallet address per card using upsert semantics — submitting a second review updates the first.

#### Scenario: Eligible user submits a review
- **WHEN** a connected wallet that has previously owned or settled a trade for the card submits a rating and optional text
- **THEN** the API SHALL persist the review attributed to that wallet address
- **AND** return the saved review with `id`, `stars`, `body`, `author_address`, and `created_at`

#### Scenario: User updates an existing review
- **WHEN** a wallet that already has a review for the card submits a new rating or text
- **THEN** the API SHALL update the existing review in place (upsert)
- **AND** return the updated review

#### Scenario: Ineligible user attempts a review
- **WHEN** a connected wallet that has never owned or traded this card submits a review
- **THEN** the API SHALL reject the request with HTTP 403 and a clear error message

#### Scenario: Invalid star rating
- **WHEN** a user submits a star value outside 1–5
- **THEN** the API SHALL reject the request with HTTP 422

#### Scenario: Body exceeds character limit
- **WHEN** a user submits a review body longer than 1 000 characters
- **THEN** the API SHALL reject the request with HTTP 422

### Requirement: Retrieve card reviews
The API SHALL expose an endpoint to fetch all reviews for a card, including the aggregate average rating and total count.

#### Scenario: Card has reviews
- **WHEN** a client requests reviews for a card that has at least one review
- **THEN** the API SHALL return the list of reviews (each with `id`, `stars`, `body`, `author_address`, `created_at`) and an aggregate object `{ average_stars, review_count }`

#### Scenario: Card has no reviews
- **WHEN** a client requests reviews for a card with no reviews
- **THEN** the API SHALL return an empty list and `{ average_stars: null, review_count: 0 }`

### Requirement: Delete own review
A reviewer SHALL be able to delete their own review. The system SHALL permanently remove the record (hard delete — reviews do not need a soft-delete trail).

#### Scenario: Author deletes their review
- **WHEN** the authenticated wallet address matches the review's `author_address`
- **THEN** the API SHALL delete the review and return HTTP 204

#### Scenario: Non-author attempts deletion
- **WHEN** a wallet address other than the review author requests deletion
- **THEN** the API SHALL return HTTP 403

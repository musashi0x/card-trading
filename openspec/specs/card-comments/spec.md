# card-comments Specification

## Purpose
TBD - created by archiving change add-card-review-and-comments. Update Purpose after archive.
## Requirements
### Requirement: Post a comment
Any authenticated (wallet-connected) user SHALL be able to post a public comment on any card's detail page. Comments are plain text with a maximum length of 1 000 characters. A per-wallet rate limit of 5 comments per card per hour SHALL be enforced.

#### Scenario: Authenticated user posts a comment
- **WHEN** a connected wallet submits a non-empty comment body (≤ 1 000 characters) for a card
- **THEN** the API SHALL persist the comment attributed to that wallet address
- **AND** return the saved comment with `id`, `body`, `author_address`, `created_at`, and `deleted_at: null`

#### Scenario: Unauthenticated user attempts to comment
- **WHEN** a request to post a comment is made without a valid wallet signature
- **THEN** the API SHALL return HTTP 401

#### Scenario: Comment body is empty
- **WHEN** a user submits a comment with an empty or whitespace-only body
- **THEN** the API SHALL return HTTP 422

#### Scenario: Comment body exceeds character limit
- **WHEN** a user submits a comment longer than 1 000 characters
- **THEN** the API SHALL return HTTP 422

#### Scenario: Rate limit exceeded
- **WHEN** a wallet has already posted 5 comments on the same card within the last hour
- **THEN** the API SHALL return HTTP 429 with a `Retry-After` header indicating when the limit resets

### Requirement: Retrieve card comments
The API SHALL expose an endpoint to fetch all non-deleted comments for a card in chronological order (oldest first). Soft-deleted comments SHALL appear as redacted placeholders.

#### Scenario: Card has comments
- **WHEN** a client requests comments for a card
- **THEN** the API SHALL return comments in ascending `created_at` order
- **AND** each comment SHALL include `id`, `body`, `author_address`, `created_at`, `deleted_at`
- **AND** comments where `deleted_at` is set SHALL have `body` replaced with `"[comment removed]"` and `author_address` set to `null`

#### Scenario: Card has no comments
- **WHEN** a client requests comments for a card with no comments
- **THEN** the API SHALL return an empty list

### Requirement: Delete own comment (soft delete)
A comment author SHALL be able to delete their own comment. The system SHALL soft-delete by setting `deleted_at`; the comment placeholder remains visible in the thread.

#### Scenario: Author soft-deletes their comment
- **WHEN** the authenticated wallet address matches the comment's `author_address`
- **THEN** the API SHALL set `deleted_at` to the current timestamp and return HTTP 204

#### Scenario: Non-author attempts deletion
- **WHEN** a wallet address other than the comment author requests deletion
- **THEN** the API SHALL return HTTP 403

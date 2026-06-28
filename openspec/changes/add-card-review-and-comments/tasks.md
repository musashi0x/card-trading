## 1. Database Migration

- [x] 1.1 Create Drizzle schema for `card_reviews` table (`id`, `card_id`, `author_address`, `stars`, `body`, `created_at`, `updated_at`) with unique constraint on `(card_id, author_address)`
- [x] 1.2 Create Drizzle schema for `card_comments` table (`id`, `card_id`, `author_address`, `body`, `created_at`, `deleted_at`)
- [x] 1.3 Generate and run the Drizzle migration file

## 2. Reviews API

- [x] 2.1 Add `GET /api/cards/:id/reviews` route — returns review list + aggregate `{ average_stars, review_count }`
- [x] 2.2 Add `POST /api/cards/:id/reviews` route — upserts a review; validates `stars` (1–5), `body` (≤ 1 000 chars), and wallet ownership via trade/listing history query
- [x] 2.3 Add `DELETE /api/cards/:id/reviews/:reviewId` route — hard-deletes; enforces author match (HTTP 403 otherwise)
- [x] 2.4 Add ownership-check helper that queries `trades`/`listings` tables to confirm the wallet has previously held the card

## 3. Comments API

- [x] 3.1 Add `GET /api/cards/:id/comments` route — returns comments oldest-first; redacts `body` and `author_address` for soft-deleted rows
- [x] 3.2 Add `POST /api/cards/:id/comments` route — validates `body` (non-empty, ≤ 1 000 chars), enforces rate limit (5 per wallet per card per hour), persists comment
- [x] 3.3 Add `DELETE /api/cards/:id/comments/:commentId` route — soft-delete (`deleted_at = now()`); enforces author match (HTTP 403 otherwise)
- [x] 3.4 Implement in-memory or DB-backed rate limit check (5 comments per wallet per card per 1 h window)

## 4. Frontend — Reviews UI

- [x] 4.1 Create `ReviewForm` component — star picker (1–5) + textarea + submit button; disabled/hidden when user is ineligible
- [x] 4.2 Create `ReviewList` component — renders aggregate rating header and individual review rows (truncated address, stars, body, relative date)
- [x] 4.3 Create `useCardReviews` hook — fetches `GET /api/cards/:id/reviews` and exposes `submitReview` / `deleteReview` mutations with optimistic updates
- [x] 4.4 Integrate `ReviewForm` + `ReviewList` into `apps/web/src/app/(marketplace)/card/[id]/page.tsx` below existing card info
- [x] 4.5 Show "Connect wallet to review" prompt when no wallet is connected; show ineligibility note when connected but not an owner/trader

## 5. Frontend — Comments UI

- [x] 5.1 Create `CommentInput` component — textarea + submit button; replaced with "Connect wallet to comment" when no wallet is connected
- [x] 5.2 Create `CommentThread` component — renders comments in chronological order; shows "[comment removed]" for soft-deleted entries; shows "Delete" button for own comments
- [x] 5.3 Create `useCardComments` hook — fetches `GET /api/cards/:id/comments` and exposes `postComment` / `deleteComment` mutations with optimistic updates
- [x] 5.4 Integrate `CommentInput` + `CommentThread` into `apps/web/src/app/(marketplace)/card/[id]/page.tsx` below the Reviews section

## 6. Validation & Testing

- [x] 6.1 Write API integration tests for review submit, upsert, ownership gate, and delete
- [x] 6.2 Write API integration tests for comment post, rate limit, soft-delete, and redaction logic
- [ ] 6.3 Manually verify the card detail page end-to-end: submit review, update review, post comment, delete comment
- [ ] 6.4 Verify ineligible-user and unauthenticated-user states render correctly in the UI

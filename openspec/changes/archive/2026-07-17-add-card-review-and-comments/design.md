## Context

The marketplace currently has no social trust layer. Cards are bought, traded, and listed without any community feedback signal. The card detail page (`apps/web/src/app/(marketplace)/card/[id]/page.tsx`) is the natural home for this feature. The backend is a Hono API (`apps/api`) with a Postgres database accessed via Drizzle ORM. Stellar wallet address is the user identity anchor.

## Goals / Non-Goals

**Goals:**
- Add `card_reviews` (1–5 star + text, one per user per card they have owned/traded) to the backend and display aggregate rating + review list on the card detail page.
- Add `card_comments` (free-form threaded comments, any authenticated user) to the backend and display as a comment thread on the card detail page.
- Both capabilities use wallet address as the author identity — no separate auth system.

**Non-Goals:**
- Moderation UI or admin dashboard (moderation fields are persisted but actioned manually via DB for now).
- Replies/threading beyond a single parent level for comments.
- Notifications for new reviews or comments.
- Review gating enforcement on-chain (ownership check is done by the API querying trade/listing history).

## Decisions

### 1. Ownership verification for reviews is off-chain
**Decision**: The API checks `trades` and `listings` tables to confirm the wallet has previously owned or settled a trade for the card before allowing a review.
**Rationale**: On-chain re-verification per review request adds latency and Stellar RPC cost. The API already has the settled trade records; querying them is free and reliable.
**Alternative considered**: Smart-contract-gated reviews. Rejected — too heavyweight for a social feature.

### 2. One review per user per card (upsert semantics)
**Decision**: `card_reviews` has a unique constraint on `(card_id, author_address)`. Submitting a second review upserts (updates) the existing one.
**Rationale**: Prevents rating-bombing; users can revise their opinion over time.

### 3. Comments are public and wallet-address-attributed
**Decision**: No anonymous comments. Author wallet address is stored and displayed (truncated) alongside each comment.
**Rationale**: Consistent with the rest of the marketplace identity model; deters spam.

### 4. Soft deletes for comments
**Decision**: Comments have a `deleted_at` timestamp. Deleted comments show as "[comment removed]" in the thread to preserve threading context.
**Rationale**: Avoids holes in comment numbering and keeps audit trail for moderation.

### 5. Aggregate rating computed in the query, not materialized
**Decision**: `AVG(stars)` and `COUNT(*)` are computed at query time on the `card_reviews` table.
**Rationale**: Review volume per card is low; a materialized column adds write complexity for negligible read gain. Revisit if P99 latency degrades.

## Risks / Trade-offs

- **Fake ownership check** → If the API's trade history is incomplete (e.g., off-chain trades not recorded), the ownership gate may reject legitimate reviewers. Mitigation: expose a clear error message and a support contact.
- **Comment spam** → No rate limiting exists yet. Mitigation: add a per-wallet rate limit (max 5 comments per card per hour) as part of the implementation.
- **Schema migration on live DB** → Two new tables. Mitigation: additive-only migration with no column renames; safe to roll back by dropping the tables.

## Migration Plan

1. Write and run a Drizzle migration to add `card_reviews` and `card_comments` tables.
2. Deploy API changes (new routes are additive, no existing route modified).
3. Deploy frontend changes (new UI sections on card detail page).
4. Rollback: remove frontend sections → revert API deploy → run `DROP TABLE` migration.

## Open Questions

- Should the aggregate star rating appear on listing cards in the marketplace grid, or only on the detail page? (Defaulting to detail page only for MVP.)
- What is the maximum comment character limit? (Defaulting to 1 000 chars for MVP.)

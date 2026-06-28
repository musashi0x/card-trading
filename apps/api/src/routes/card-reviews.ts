/**
 * Card-level reviews. Mounted at `/api/catalog/:id/reviews`.
 * Only wallets that previously bought or sold the card may submit a review
 * (off-chain ownership check via trades + listings tables). One review per
 * (card, wallet) enforced by DB unique index; re-submitting upserts.
 */

import { Router } from 'express';
import { and, avg, count, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cardmkt/db';

export const cardReviewsRouter: Router = Router({ mergeParams: true });

const { cardReviews, trades, listings, cards } = schema;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

const reviewBodySchema = z.object({
  authorAddress: z.string().regex(STELLAR_ADDRESS, 'Invalid Stellar address'),
  stars: z.number().int().min(1).max(5),
  body: z.string().trim().max(1000).nullish(),
});

/** Returns true if the wallet has previously owned or sold this card. */
async function hasOwnedCard(cardId: string, address: string): Promise<boolean> {
  // Check if they were buyer or seller on a settled trade linked to a listing for this card.
  const [tradeMatch] = await db
    .select({ id: trades.id })
    .from(trades)
    .innerJoin(listings, eq(trades.listingId, listings.id))
    .where(
      and(
        eq(listings.cardId, cardId),
        or(eq(trades.buyer, address), eq(trades.seller, address)),
      ),
    )
    .limit(1);
  if (tradeMatch) return true;

  // Also allow a seller who listed the card (even without a settled trade).
  const [listingMatch] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.cardId, cardId), eq(listings.seller, address)))
    .limit(1);
  return !!listingMatch;
}

// GET /api/catalog/:id/reviews
cardReviewsRouter.get('/', async (req, res, next) => {
  try {
    const { id: cardId } = req.params as { id: string };
    const rows = await db
      .select()
      .from(cardReviews)
      .where(eq(cardReviews.cardId, cardId))
      .orderBy(cardReviews.createdAt);

    const [agg] = await db
      .select({ avg: avg(cardReviews.stars), cnt: count() })
      .from(cardReviews)
      .where(eq(cardReviews.cardId, cardId));

    res.json({
      reviews: rows.map((r) => ({
        id: r.id,
        cardId: r.cardId,
        authorAddress: r.authorAddress,
        stars: r.stars,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      aggregate: {
        averageStars: agg?.avg != null ? Number(agg.avg) : null,
        reviewCount: Number(agg?.cnt ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/catalog/:id/reviews
cardReviewsRouter.post('/', async (req, res, next) => {
  try {
    const { id: cardId } = req.params as { id: string };

    const [card] = await db.select({ id: cards.id }).from(cards).where(eq(cards.id, cardId));
    if (!card) {
      res.status(404).json({ error: 'Card not found', code: 'CARD_NOT_FOUND' });
      return;
    }

    const body = reviewBodySchema.parse(req.body);

    if (!(await hasOwnedCard(cardId, body.authorAddress))) {
      res.status(403).json({
        error: 'Only previous owners or traders of this card can leave a review',
        code: 'NOT_ELIGIBLE',
      });
      return;
    }

    const now = new Date();
    const [row] = await db
      .insert(cardReviews)
      .values({
        cardId,
        authorAddress: body.authorAddress,
        stars: body.stars,
        body: body.body ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cardReviews.cardId, cardReviews.authorAddress],
        set: {
          stars: body.stars,
          body: body.body ?? null,
          updatedAt: now,
        },
      })
      .returning();
    if (!row) throw new Error('Failed to upsert review');

    res.status(201).json({
      id: row.id,
      cardId: row.cardId,
      authorAddress: row.authorAddress,
      stars: row.stars,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/catalog/:id/reviews/:reviewId
cardReviewsRouter.delete('/:reviewId', async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    const authorAddress = req.query.authorAddress as string;

    if (!authorAddress || !STELLAR_ADDRESS.test(authorAddress)) {
      res.status(400).json({ error: 'authorAddress query param required', code: 'INVALID_PARAMS' });
      return;
    }

    const [existing] = await db
      .select({ id: cardReviews.id, authorAddress: cardReviews.authorAddress })
      .from(cardReviews)
      .where(eq(cardReviews.id, reviewId));

    if (!existing) {
      res.status(404).json({ error: 'Review not found', code: 'NOT_FOUND' });
      return;
    }

    if (existing.authorAddress !== authorAddress) {
      res.status(403).json({ error: 'You can only delete your own reviews', code: 'FORBIDDEN' });
      return;
    }

    await db.delete(cardReviews).where(eq(cardReviews.id, reviewId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * Card-level comments. Mounted at `/api/catalog/:id/comments`.
 * Any wallet-connected user may comment. Rate limited to 5 comments per wallet
 * per card per hour (in-memory sliding window). Soft-delete: deleted comments
 * keep the row but redact body + author in list responses.
 */

import { Router } from 'express';
import { and, asc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cardmkt/db';

export const cardCommentsRouter: Router = Router({ mergeParams: true });

const { cardComments, cards } = schema;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const commentBodySchema = z.object({
  authorAddress: z.string().regex(STELLAR_ADDRESS, 'Invalid Stellar address'),
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(1000, 'Comment must be 1 000 characters or fewer'),
});

// In-memory rate limit: Map<`${cardId}:${address}`, timestamp[]>
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(cardId: string, address: string): { allowed: boolean; retryAfterSecs: number } {
  const key = `${cardId}:${address}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const timestamps = (rateLimitMap.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= RATE_LIMIT_MAX) {
    const oldest = timestamps[0]!;
    const retryAfterSecs = Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSecs };
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return { allowed: true, retryAfterSecs: 0 };
}

// GET /api/catalog/:id/comments
cardCommentsRouter.get('/', async (req, res, next) => {
  try {
    const { id: cardId } = req.params as { id: string };
    const rows = await db
      .select()
      .from(cardComments)
      .where(eq(cardComments.cardId, cardId))
      .orderBy(asc(cardComments.createdAt));

    res.json(
      rows.map((r) => ({
        id: r.id,
        cardId: r.cardId,
        authorAddress: r.deletedAt ? null : r.authorAddress,
        body: r.deletedAt ? '[comment removed]' : r.body,
        createdAt: r.createdAt.toISOString(),
        deletedAt: r.deletedAt?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/catalog/:id/comments
cardCommentsRouter.post('/', async (req, res, next) => {
  try {
    const { id: cardId } = req.params as { id: string };

    const [card] = await db.select({ id: cards.id }).from(cards).where(eq(cards.id, cardId));
    if (!card) {
      res.status(404).json({ error: 'Card not found', code: 'CARD_NOT_FOUND' });
      return;
    }

    const body = commentBodySchema.parse(req.body);

    const rl = checkRateLimit(cardId, body.authorAddress);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSecs));
      res.status(429).json({
        error: `Rate limit exceeded — try again in ${rl.retryAfterSecs}s`,
        code: 'RATE_LIMITED',
      });
      return;
    }

    const [row] = await db
      .insert(cardComments)
      .values({ cardId, authorAddress: body.authorAddress, body: body.body })
      .returning();
    if (!row) throw new Error('Failed to insert comment');

    res.status(201).json({
      id: row.id,
      cardId: row.cardId,
      authorAddress: row.authorAddress,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      deletedAt: null,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/catalog/:id/comments/:commentId
cardCommentsRouter.delete('/:commentId', async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const authorAddress = req.query.authorAddress as string;

    if (!authorAddress || !STELLAR_ADDRESS.test(authorAddress)) {
      res.status(400).json({ error: 'authorAddress query param required', code: 'INVALID_PARAMS' });
      return;
    }

    const [existing] = await db
      .select({ id: cardComments.id, authorAddress: cardComments.authorAddress, deletedAt: cardComments.deletedAt })
      .from(cardComments)
      .where(eq(cardComments.id, commentId));

    if (!existing) {
      res.status(404).json({ error: 'Comment not found', code: 'NOT_FOUND' });
      return;
    }

    if (existing.authorAddress !== authorAddress) {
      res.status(403).json({ error: 'You can only delete your own comments', code: 'FORBIDDEN' });
      return;
    }

    if (existing.deletedAt) {
      res.status(204).end();
      return;
    }

    await db
      .update(cardComments)
      .set({ deletedAt: new Date() })
      .where(eq(cardComments.id, commentId));

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * User profiles + counterparty reviews. Open-auth like the rest of the API —
 * the wallet address is a path/body parameter, not a secret. Profile stats and
 * achievement badges are derived at query time from the trades/listings/reviews
 * tables (no materialised columns); see the change design for rationale.
 */

import { Router } from 'express';
import { and, avg, count, desc, eq, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cardmkt/db';
import type { Achievement, ProfileResponse, ProfileStatsResponse } from '@cardmkt/shared';
import { accountCreatedAt } from '../stellar.js';

export const profilesRouter: Router = Router();

const { users, trades, offers, reviews } = schema;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

const updateSchema = z.object({
  displayName: z.string().trim().max(60).nullish(),
  bio: z.string().trim().max(500).nullish(),
  location: z.string().trim().max(80).nullish(),
  website: z.string().trim().max(120).nullish(),
  avatarUrl: z.string().max(2_000_000).nullish(),
});

const reviewSchema = z.object({
  reviewerAddress: z.string().regex(STELLAR_ADDRESS, 'Invalid reviewer address'),
  tradeId: z.string().uuid('tradeId must be a UUID'),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(1000).nullish(),
});

function requireAddress(value: string, res: import('express').Response): boolean {
  if (STELLAR_ADDRESS.test(value)) return true;
  res.status(400).json({ error: 'Invalid account address', code: 'INVALID_ACCOUNT' });
  return false;
}

async function toProfile(row: typeof users.$inferSelect): Promise<ProfileResponse> {
  // Prefer the real on-chain account creation time; fall back to the users-row
  // timestamp for contract accounts or when Horizon can't resolve it.
  const onChainCreated = await accountCreatedAt(row.stellarAddress);
  return {
    address: row.stellarAddress,
    displayName: row.displayName,
    bio: row.bio,
    location: row.location,
    website: row.website,
    avatarUrl: row.avatarUrl,
    memberSince: onChainCreated ?? row.createdAt.toISOString(),
  };
}

function getDeterministicAvatar(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = (hash * 31 + address.charCodeAt(i)) >>> 0;
  }
  const index = hash % 3;
  return `/avatars/avatar-${index + 1}.png`;
}

/** Fetch the users row for an address, creating an empty one on first sight. */
async function ensureUser(address: string): Promise<typeof users.$inferSelect> {
  const [existing] = await db.select().from(users).where(eq(users.stellarAddress, address));
  if (existing) return existing;
  const [created] = await db
    .insert(users)
    .values({
      stellarAddress: address,
      avatarUrl: getDeterministicAvatar(address),
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Lost a race — the row now exists; read it back.
  const [row] = await db.select().from(users).where(eq(users.stellarAddress, address));
  if (!row) throw new Error('Failed to create or load user row');
  return row;
}

// GET /api/profiles/:address — fetch (or lazily create) the profile.
profilesRouter.get('/:address', async (req, res, next) => {
  try {
    if (!requireAddress(req.params.address, res)) return;
    res.json(await toProfile(await ensureUser(req.params.address)));
  } catch (err) {
    next(err);
  }
});

// PUT /api/profiles/:address — update the editable profile fields.
profilesRouter.put('/:address', async (req, res, next) => {
  try {
    if (!requireAddress(req.params.address, res)) return;
    const body = updateSchema.parse(req.body);
    await ensureUser(req.params.address);
    const [updated] = await db
      .update(users)
      .set(body)
      .where(eq(users.stellarAddress, req.params.address))
      .returning();
    res.json(await toProfile(updated ?? (await ensureUser(req.params.address))));
  } catch (err) {
    next(err);
  }
});

// GET /api/profiles/:address/stats — stats + achievements derived from activity.
profilesRouter.get('/:address/stats', async (req, res, next) => {
  try {
    const address = req.params.address;
    if (!requireAddress(address, res)) return;

    const [bought] = await db
      .select({ c: count(), value: sum(trades.priceUsdc), top: sql<string>`coalesce(max(${trades.priceUsdc}), 0)` })
      .from(trades)
      .where(eq(trades.buyer, address));
    const [sold] = await db
      .select({ c: count() })
      .from(trades)
      .where(eq(trades.seller, address));
    const [reviewAgg] = await db
      .select({ c: count(), avg: avg(reviews.rating) })
      .from(reviews)
      .where(eq(reviews.revieweeAddress, address));
    const [offerAgg] = await db
      .select({ c: count() })
      .from(offers)
      .where(eq(offers.buyer, address));

    const cardsOwned = Number(bought?.c ?? 0);
    const cardsSold = Number(sold?.c ?? 0);
    const reviewCount = Number(reviewAgg?.c ?? 0);
    const sellerRating = reviewAgg?.avg != null ? Number(reviewAgg.avg) : null;
    const offersMade = Number(offerAgg?.c ?? 0);
    const winRate = offersMade > 0 ? Math.round((cardsOwned / offersMade) * 100) : null;
    const topBuy = Number(bought?.top ?? 0);

    const achievements: Achievement[] = [
      { key: 'first_win', name: 'First win', description: 'Won your first card', earned: cardsOwned >= 1 },
      { key: 'first_sale', name: 'First sale', description: 'Sold your first card', earned: cardsSold >= 1 },
      { key: 'century_club', name: 'Century club', description: '100+ cards collected', earned: cardsOwned >= 100 },
      { key: 'five_star', name: '5-star seller', description: '50 reviews at 4.5+', earned: reviewCount >= 50 && (sellerRating ?? 0) >= 4.5 },
      { key: 'big_spender', name: 'Big spender', description: '$10k in a single purchase', earned: topBuy >= 10000 },
      { key: 'power_seller', name: 'Power seller', description: 'Sold 10+ cards', earned: cardsSold >= 10 },
    ];

    const stats: ProfileStatsResponse = {
      address,
      collectionValueUsdc: Number(bought?.value ?? 0).toFixed(7),
      cardsOwned,
      cardsSold,
      sellerRating,
      reviewCount,
      winRate,
      achievements,
    };
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// GET /api/profiles/:address/reviews — reviews written about this address.
profilesRouter.get('/:address/reviews', async (req, res, next) => {
  try {
    if (!requireAddress(req.params.address, res)) return;
    const rows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.revieweeAddress, req.params.address))
      .orderBy(desc(reviews.createdAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/profiles/:address/reviews — review the counterparty of a trade.
profilesRouter.post('/:address/reviews', async (req, res, next) => {
  try {
    const reviewee = req.params.address;
    if (!requireAddress(reviewee, res)) return;
    const body = reviewSchema.parse(req.body);
    if (body.reviewerAddress === reviewee) {
      res.status(400).json({ error: 'Cannot review yourself', code: 'SELF_REVIEW' });
      return;
    }

    // The reviewer and reviewee must be the two parties of the referenced trade.
    const [trade] = await db.select().from(trades).where(eq(trades.id, body.tradeId));
    if (!trade) {
      res.status(404).json({ error: 'Trade not found', code: 'TRADE_NOT_FOUND' });
      return;
    }
    const parties = [trade.buyer, trade.seller];
    if (!parties.includes(body.reviewerAddress) || !parties.includes(reviewee)) {
      res.status(403).json({ error: 'Only a counterparty of this trade can review it', code: 'NOT_COUNTERPARTY' });
      return;
    }

    // One review per (reviewer, trade).
    const [dupe] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.reviewerAddress, body.reviewerAddress), eq(reviews.tradeId, body.tradeId)));
    if (dupe) {
      res.status(409).json({ error: 'You already reviewed this trade', code: 'ALREADY_REVIEWED' });
      return;
    }

    const [created] = await db
      .insert(reviews)
      .values({
        reviewerAddress: body.reviewerAddress,
        revieweeAddress: reviewee,
        tradeId: body.tradeId,
        rating: body.rating,
        text: body.text ?? null,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

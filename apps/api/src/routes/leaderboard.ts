/**
 * Leaderboard aggregation endpoint. Three ranked boards — collectors (season
 * collection value), sellers (90-day gross sales volume), traders (all-time
 * realized profit) — are derived live from the `trades`/`listings` tables via
 * Postgres GROUP BY aggregates.
 *
 * Board rows are cached in-process for 5 minutes keyed on `(board, limit)`; the
 * requesting account's own standing is computed fresh on every request (a single
 * filtered lookup), so a cache hit never staleness-leaks a user's own rank.
 *
 * Seller rating depends on the `reviews` table (added by the user-profiles
 * change). When that table is absent the board degrades gracefully: `avgRating`
 * is null on every row and the response carries `ratingAvailable: false`.
 */

import { Router } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@cardmkt/db';
import type {
  LeaderboardBoard,
  LeaderboardOwnStanding,
  LeaderboardResponse,
  LeaderboardRow,
} from '@cardmkt/shared';

export const leaderboardRouter: Router = Router();

const requestSchema = z.object({
  board: z.enum(['collectors', 'sellers', 'traders']),
  account: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Board rows cached for 5 minutes; the account standing is never cached. */
const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry = { ts: number; rows: LeaderboardRow[] };
export const boardCache = new Map<string, CacheEntry>();

/** A raw aggregation row as Postgres returns it (numeric columns are strings). */
type RawRow = Record<string, unknown>;

function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

/** Decimal-string money with the 7-dp scale the rest of the API uses for USDC. */
function money(v: unknown): string {
  return num(v).toFixed(7);
}

/**
 * Format ROI as a signed percentage to one decimal place using a true minus
 * sign (`−`, U+2212) for losses, per the leaderboard spec. `null` total buy cost
 * (no buy history) yields a `null` ROI.
 */
export function formatRoi(profit: number, buyTotal: number): string | null {
  if (buyTotal <= 0) return null;
  const pct = (profit / buyTotal) * 100;
  const sign = pct < 0 ? '−' : '+';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function winRate(won: unknown, offers: unknown): number | null {
  const o = num(offers);
  return o > 0 ? Math.round((num(won) / o) * 100) : null;
}

/** Zero-valued metrics shared by every board's "no activity" standing. */
const ZERO_METRICS: Omit<LeaderboardRow, 'rank' | 'stellarAddress'> = {
  collectionValue: '0',
  cardsHeld: 0,
  winRate: null,
  salesVolume90d: '0',
  salesCount: 0,
  avgRating: null,
  realizedProfit: '0',
  roi: null,
  flipCount: 0,
};

/** Project a raw aggregation row onto the shared `LeaderboardRow` shape. */
function toRow(board: LeaderboardBoard, raw: RawRow): LeaderboardRow {
  const base = {
    rank: num(raw.rank),
    stellarAddress: String(raw.address),
    ...ZERO_METRICS,
  };
  if (board === 'collectors') {
    return {
      ...base,
      collectionValue: money(raw.collection_value),
      cardsHeld: num(raw.cards_held),
      winRate: winRate(raw.won, raw.offers_made),
    };
  }
  if (board === 'sellers') {
    return {
      ...base,
      salesVolume90d: money(raw.sales_volume),
      salesCount: num(raw.sales_count),
      avgRating: raw.avg_rating == null ? null : Number(num(raw.avg_rating).toFixed(2)),
    };
  }
  return {
    ...base,
    realizedProfit: money(raw.realized_profit),
    roi: formatRoi(num(raw.realized_profit), num(raw.buy_total)),
    flipCount: num(raw.flip_count),
  };
}

// ---------------------------------------------------------------------------
// Board aggregation SQL. Each returns rows with an `address`, the board's
// metric columns, and a `rank` window so the same query serves both the top-N
// board and the single-account own-standing lookup.
// ---------------------------------------------------------------------------

/**
 * Collectors — current calendar year. Per (address, card) net holdings
 * (buys − sells); held cards (net > 0) are valued at the user's last buy price
 * within the year. Every user with at least one current-year buy appears, even
 * if they have since sold out (value 0).
 */
function collectorsRanked(): SQL {
  return sql`
    SELECT *, RANK() OVER (
      ORDER BY collection_value DESC, cards_held DESC, address ASC
    ) AS rank
    FROM (
      WITH yr AS (
        SELECT t.buyer, t.seller, t.price_usdc, t.settled_at, l.card_id
        FROM trades t
        JOIN listings l ON l.id = t.listing_id
        WHERE date_trunc('year', t.settled_at) = date_trunc('year', now())
      ),
      net AS (
        SELECT addr, card_id, SUM(b) - SUM(s) AS net
        FROM (
          SELECT buyer AS addr, card_id, 1 AS b, 0 AS s FROM yr
          UNION ALL
          SELECT seller AS addr, card_id, 0 AS b, 1 AS s FROM yr
        ) m
        GROUP BY addr, card_id
      ),
      last_buy AS (
        SELECT DISTINCT ON (buyer, card_id) buyer AS addr, card_id, price_usdc
        FROM yr
        ORDER BY buyer, card_id, settled_at DESC
      ),
      held AS (
        SELECT n.addr, n.net, COALESCE(lb.price_usdc, 0) AS last_buy_price
        FROM net n
        LEFT JOIN last_buy lb ON lb.addr = n.addr AND lb.card_id = n.card_id
        WHERE n.net > 0
      ),
      holdings AS (
        SELECT addr,
          COALESCE(SUM(last_buy_price * net), 0) AS collection_value,
          COALESCE(SUM(net), 0) AS cards_held
        FROM held
        GROUP BY addr
      ),
      buyers AS (
        SELECT buyer AS addr, COUNT(*) AS won FROM yr GROUP BY buyer
      )
      SELECT b.addr AS address,
        COALESCE(h.collection_value, 0) AS collection_value,
        COALESCE(h.cards_held, 0) AS cards_held,
        b.won,
        (SELECT COUNT(*) FROM offers o WHERE o.buyer = b.addr) AS offers_made
      FROM buyers b
      LEFT JOIN holdings h ON h.addr = b.addr
    ) base
  `;
}

/**
 * Sellers — trailing 90 days. Gross `priceUsdc` volume per seller, with the
 * average counterparty rating joined in when `reviews` is available.
 */
function sellersRanked(ratingAvailable: boolean): SQL {
  const ratingJoin = ratingAvailable
    ? sql`LEFT JOIN (
        SELECT reviewee_address, AVG(rating) AS avg_rating
        FROM reviews GROUP BY reviewee_address
      ) r ON r.reviewee_address = s.address`
    : sql``;
  const ratingCol = ratingAvailable ? sql`r.avg_rating` : sql`NULL`;
  return sql`
    SELECT *, RANK() OVER (
      ORDER BY sales_volume DESC, sales_count DESC, address ASC
    ) AS rank
    FROM (
      SELECT s.address, s.sales_volume, s.sales_count, ${ratingCol} AS avg_rating
      FROM (
        SELECT seller AS address,
          SUM(price_usdc) AS sales_volume,
          COUNT(*) AS sales_count
        FROM trades
        WHERE settled_at >= now() - interval '90 days'
        GROUP BY seller
      ) s
      ${ratingJoin}
    ) base
  `;
}

/**
 * Traders — all time. Realized profit = sell net (price − fee − royalty) minus
 * buy cost; ROI is profit ÷ buy cost; flips are completed buy→sell card pairs
 * (LEAST(buys, sells) per card). Only users with at least one sell appear.
 */
function tradersRanked(): SQL {
  return sql`
    SELECT *, RANK() OVER (
      ORDER BY realized_profit DESC, address ASC
    ) AS rank
    FROM (
      WITH tc AS (
        SELECT t.buyer, t.seller, t.price_usdc, t.fee_usdc, t.royalty_usdc, l.card_id
        FROM trades t
        JOIN listings l ON l.id = t.listing_id
      ),
      moves AS (
        SELECT buyer AS address, card_id,
          price_usdc AS buy_cost, 0::numeric AS sell_net, 1 AS is_buy, 0 AS is_sell
        FROM tc
        UNION ALL
        SELECT seller AS address, card_id,
          0::numeric AS buy_cost, (price_usdc - fee_usdc - royalty_usdc) AS sell_net,
          0 AS is_buy, 1 AS is_sell
        FROM tc
      ),
      per_card AS (
        SELECT address, SUM(is_buy) AS buys, SUM(is_sell) AS sells
        FROM moves GROUP BY address, card_id
      ),
      flips AS (
        SELECT address, SUM(LEAST(buys, sells)) AS flip_count
        FROM per_card GROUP BY address
      ),
      totals AS (
        SELECT address,
          SUM(buy_cost) AS buy_total,
          SUM(sell_net) AS sell_total,
          SUM(is_sell) AS sells
        FROM moves GROUP BY address
      )
      SELECT t.address,
        (t.sell_total - t.buy_total) AS realized_profit,
        t.buy_total,
        COALESCE(f.flip_count, 0) AS flip_count
      FROM totals t
      LEFT JOIN flips f ON f.address = t.address
      WHERE t.sells > 0
    ) base
  `;
}

function rankedSql(board: LeaderboardBoard, ratingAvailable: boolean): SQL {
  if (board === 'collectors') return collectorsRanked();
  if (board === 'sellers') return sellersRanked(ratingAvailable);
  return tradersRanked();
}

// ---------------------------------------------------------------------------
// `reviews` table existence probe — run once, cached for the process lifetime.
// ---------------------------------------------------------------------------

let reviewsProbe: Promise<boolean> | null = null;
export function reviewsTableExists(): Promise<boolean> {
  if (!reviewsProbe) {
    reviewsProbe = db
      .execute(sql`SELECT to_regclass('public.reviews') IS NOT NULL AS present`)
      .then((rows) => Boolean((rows as unknown as RawRow[])[0]?.present))
      .catch(() => false);
  }
  return reviewsProbe;
}

async function runRanked(ranked: SQL): Promise<RawRow[]> {
  const rows = await db.execute(ranked);
  return rows as unknown as RawRow[];
}

/** Compute (uncached) the top-N ranked rows for a board. */
export async function computeBoardRows(
  board: LeaderboardBoard,
  limit: number,
  ratingAvailable: boolean,
): Promise<LeaderboardRow[]> {
  const ranked = rankedSql(board, ratingAvailable);
  const raw = await runRanked(sql`SELECT * FROM (${ranked}) r ORDER BY rank LIMIT ${limit}`);
  return raw.map((row) => toRow(board, row));
}

/** Cache-aware board rows; serves cached rows within the TTL window. */
async function getBoardRows(
  board: LeaderboardBoard,
  limit: number,
  ratingAvailable: boolean,
): Promise<CacheEntry> {
  const key = `${board}:${limit}`;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.ts <= CACHE_TTL_MS) return hit;
  const rows = await computeBoardRows(board, limit, ratingAvailable);
  const entry: CacheEntry = { ts: Date.now(), rows };
  boardCache.set(key, entry);
  return entry;
}

/** The requesting account's standing — always fresh, never cached. */
async function getOwnStanding(
  board: LeaderboardBoard,
  account: string,
  ratingAvailable: boolean,
): Promise<LeaderboardOwnStanding> {
  const ranked = rankedSql(board, ratingAvailable);
  const raw = await runRanked(sql`SELECT * FROM (${ranked}) r WHERE address = ${account}`);
  const found = raw[0];
  if (!found) {
    return { rank: null, stellarAddress: account, ...ZERO_METRICS };
  }
  const row = toRow(board, found);
  return { ...row, rank: row.rank };
}

leaderboardRouter.get('/', async (req, res, next) => {
  try {
    const { board, account, limit } = requestSchema.parse(req.query);
    // Rating only applies to the sellers board; null elsewhere.
    const ratingAvailable = board === 'sellers' ? await reviewsTableExists() : null;

    const { rows, ts } = await getBoardRows(board, limit, ratingAvailable ?? false);
    const ownStanding = account
      ? await getOwnStanding(board, account, ratingAvailable ?? false)
      : null;

    const response: LeaderboardResponse = {
      board,
      rows,
      ownStanding,
      ratingAvailable,
      cachedAt: new Date(ts).toISOString(),
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

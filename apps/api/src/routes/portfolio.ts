/**
 * Portfolio valuation (add-portfolio-valuation change). Resolves a wallet's real
 * card holdings from the `card_copies.owner` mirror, values each with a
 * market-price waterfall, derives cost basis from the account's own purchase
 * trades, and aggregates totals, rarity allocation, best/worst performer, and a
 * synthesized 12-month value-history series — all computed on the fly from the
 * existing `cards`, `cardCopies`, `listings`, and `trades` tables (no snapshot
 * store; see design.md).
 *
 * The pure computation helpers (`valuateCard`, `costBasisFor`, `buildHistory`,
 * `monthEndsEndingAt`, `monthKey`) are exported and unit-tested independently of
 * any DB or chain I/O.
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import type {
  PortfolioAllocation,
  PortfolioHolding,
  PortfolioPerformer,
  PortfolioResponse,
  ValuedAt,
} from '@cardmkt/shared';

export const portfolioRouter: Router = Router();

const { cards, cardCopies, listings, trades } = schema;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

/** USDC amounts are serialized as fixed-7 decimal strings, like the rest of the API. */
function usd(n: number): string {
  return n.toFixed(7);
}

// --- pure valuation helpers (no I/O — unit-tested directly) ---

/** A settled trade for a card, reduced to the fields valuation needs. */
export interface ValuationTrade {
  priceUsdc: string;
  settledAt: Date;
}

/** An open listing for a card, reduced to the fields valuation needs. */
export interface ValuationListing {
  priceUsdc: string;
  createdAt: Date;
}

/**
 * Value a single card via the waterfall: most recent settled trade price → lowest
 * open listing price → zero. When `asOf` is given, only trades settled at/before
 * it and listings created at/before it count (used for historical months); when
 * omitted, all data counts (the live valuation).
 */
export function valuateCard(
  cardTrades: ValuationTrade[],
  cardListings: ValuationListing[],
  asOf?: Date,
): { value: number; valuedAt: ValuedAt } {
  const tradesInScope = asOf ? cardTrades.filter((t) => t.settledAt <= asOf) : cardTrades;
  if (tradesInScope.length) {
    const latest = tradesInScope.reduce((a, b) => (a.settledAt >= b.settledAt ? a : b));
    return { value: Number(latest.priceUsdc), valuedAt: 'trade' };
  }
  const listingsInScope = asOf
    ? cardListings.filter((l) => l.createdAt <= asOf)
    : cardListings;
  if (listingsInScope.length) {
    const lowest = listingsInScope.reduce((a, b) =>
      Number(a.priceUsdc) <= Number(b.priceUsdc) ? a : b,
    );
    return { value: Number(lowest.priceUsdc), valuedAt: 'listing' };
  }
  return { value: 0, valuedAt: null };
}

/**
 * Cost basis for a holding = the price of the account's most recent purchase
 * trade for that card. With no purchase trade the basis is unknown (the card was
 * minted or transferred in), reported as `0` with `costBasisKnown: false`.
 */
export function costBasisFor(purchaseTrades: ValuationTrade[]): {
  costBasis: number;
  costBasisKnown: boolean;
} {
  if (!purchaseTrades.length) return { costBasis: 0, costBasisKnown: false };
  const latest = purchaseTrades.reduce((a, b) => (a.settledAt >= b.settledAt ? a : b));
  return { costBasis: Number(latest.priceUsdc), costBasisKnown: true };
}

/** `YYYY-MM` for a date, in UTC. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The last instant (UTC) of each of the 12 months ending with the month of
 * `now`, oldest-first. Each boundary is `23:59:59.999` of that month's last day,
 * so a value computed "as of" it includes everything that happened in the month.
 */
export function monthEndsEndingAt(now: Date): Date[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const ends: Date[] = [];
  for (let i = 11; i >= 0; i--) {
    // Start of the month after the target month, minus 1ms = end of target month.
    const end = new Date(Date.UTC(y, m - i + 1, 1, 0, 0, 0, 0));
    end.setUTCMilliseconds(-1);
    ends.push(end);
  }
  return ends;
}

/** A card's full trade + open-listing history, for historical valuation. */
export interface HistoryCardData {
  trades: ValuationTrade[];
  listings: ValuationListing[];
}

export interface HistoryInputs {
  /** 12 month-end boundaries, oldest-first (see {@link monthEndsEndingAt}). */
  monthEnds: Date[];
  /** Per-card valuation data, keyed by card id. */
  cardData: Map<string, HistoryCardData>;
  /** Account purchase events (card acquired at `settledAt`). */
  buys: { cardId: string; settledAt: Date }[];
  /** Account sale events (card sold at `settledAt`). */
  sells: { cardId: string; settledAt: Date }[];
  /**
   * The live portfolio total, used verbatim for the final (current) month so the
   * chart's last bar always equals the headline number — the historical synthesis
   * (buy/sell trades only) can't see minted-but-never-traded holdings.
   */
  liveTotal: number;
}

/**
 * Synthesize the 12-month value series. For each prior month, the held set is the
 * cards bought minus the cards sold by that month-end, each valued with only the
 * data available then. The current month is the live total.
 */
export function buildHistory(inputs: HistoryInputs): { month: string; value: number }[] {
  const { monthEnds, cardData, buys, sells, liveTotal } = inputs;
  const lastIdx = monthEnds.length - 1;
  return monthEnds.map((monthEnd, idx) => {
    if (idx === lastIdx) return { month: monthKey(monthEnd), value: liveTotal };
    const held = new Set<string>();
    for (const b of buys) if (b.settledAt <= monthEnd) held.add(b.cardId);
    for (const s of sells) if (s.settledAt <= monthEnd) held.delete(s.cardId);
    let value = 0;
    for (const cardId of held) {
      const data = cardData.get(cardId);
      if (data) value += valuateCard(data.trades, data.listings, monthEnd).value;
    }
    return { month: monthKey(monthEnd), value };
  });
}

/** Rarity buckets in display order (drives the allocation bar). */
const RARITY_ORDER = ['legendary', 'epic', 'rare', 'common'];

// GET /api/portfolio?account=G…|C… — the wallet's live portfolio.
portfolioRouter.get('/', async (req, res, next) => {
  try {
    const account = typeof req.query.account === 'string' ? req.query.account.trim() : '';
    if (!STELLAR_ADDRESS.test(account)) {
      // Reject before any chain call so an invalid address never hits Horizon/RPC.
      res.status(400).json({ error: 'Invalid account address', code: 'INVALID_ACCOUNT' });
      return;
    }

    // Pull the small read-mirror in full and compute on the fly (design Decision 1).
    const [cardRows, openListingRows, tradeRows] = await Promise.all([
      db.select().from(cards),
      db
        .select({
          cardId: listings.cardId,
          seller: listings.seller,
          priceUsdc: listings.priceUsdc,
          createdAt: listings.createdAt,
        })
        .from(listings)
        .where(eq(listings.status, 'open')),
      db
        .select({
          cardId: listings.cardId,
          buyer: trades.buyer,
          seller: trades.seller,
          priceUsdc: trades.priceUsdc,
          settledAt: trades.settledAt,
        })
        .from(trades)
        .innerJoin(listings, eq(trades.listingId, listings.id)),
    ]);

    // Group trades + open listings by card for valuation and cost basis.
    const tradesByCard = new Map<string, ValuationTrade[]>();
    const buyTradesByCard = new Map<string, ValuationTrade[]>();
    const sells: { cardId: string; settledAt: Date }[] = [];
    const buys: { cardId: string; settledAt: Date }[] = [];
    for (const t of tradeRows) {
      const vt: ValuationTrade = { priceUsdc: t.priceUsdc, settledAt: t.settledAt };
      (tradesByCard.get(t.cardId) ?? tradesByCard.set(t.cardId, []).get(t.cardId)!).push(vt);
      if (t.buyer === account) {
        (buyTradesByCard.get(t.cardId) ?? buyTradesByCard.set(t.cardId, []).get(t.cardId)!).push(vt);
        buys.push({ cardId: t.cardId, settledAt: t.settledAt });
      }
      if (t.seller === account) sells.push({ cardId: t.cardId, settledAt: t.settledAt });
    }
    const listingsByCard = new Map<string, ValuationListing[]>();
    const openListedByAccount = new Set<string>();
    for (const l of openListingRows) {
      const vl: ValuationListing = { priceUsdc: l.priceUsdc, createdAt: l.createdAt };
      (listingsByCard.get(l.cardId) ?? listingsByCard.set(l.cardId, []).get(l.cardId)!).push(vl);
      if (l.seller === account) openListedByAccount.add(l.cardId);
    }

    // Holdings = cards with at least one copy owned by this wallet (per the
    // `card_copies.owner` mirror) ∪ cards the account currently has open-listed
    // (the mirror isn't updated until settlement, so a listed copy is already
    // included here — the union is a harmless no-op kept for parity/safety).
    const ownedCopies = await db
      .select({ cardId: cardCopies.cardId })
      .from(cardCopies)
      .where(eq(cardCopies.owner, account));
    const holdingIds = new Set<string>(ownedCopies.map((r) => r.cardId));
    for (const id of openListedByAccount) holdingIds.add(id);

    const cardById = new Map(cardRows.map((c) => [c.id, c]));
    const holdings: PortfolioHolding[] = [];
    for (const id of holdingIds) {
      const card = cardById.get(id);
      if (!card) continue;
      const { value, valuedAt } = valuateCard(
        tradesByCard.get(id) ?? [],
        listingsByCard.get(id) ?? [],
      );
      const { costBasis, costBasisKnown } = costBasisFor(buyTradesByCard.get(id) ?? []);
      holdings.push({
        cardId: id,
        name: card.name,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        value: usd(value),
        valuedAt,
        costBasis: usd(costBasis),
        costBasisKnown,
        listed: openListedByAccount.has(id),
      });
    }

    // Totals + unrealized P&L over holdings with a known cost basis only.
    const totalValue = holdings.reduce((s, h) => s + Number(h.value), 0);
    const known = holdings.filter((h) => h.costBasisKnown);
    const knownValue = known.reduce((s, h) => s + Number(h.value), 0);
    const totalCost = known.reduce((s, h) => s + Number(h.costBasis), 0);
    const unrealizedGain = knownValue - totalCost;
    const unrealizedGainPct = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : null;

    // Allocation by rarity, value-weighted, in display order.
    const rarity: PortfolioAllocation[] = RARITY_ORDER.flatMap((r) => {
      const value = holdings
        .filter((h) => h.rarity.toLowerCase() === r)
        .reduce((s, h) => s + Number(h.value), 0);
      if (value <= 0) return [];
      return [{ rarity: r, value: usd(value), pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }];
    });

    // Best/worst performer — only meaningful with ≥2 known-cost holdings.
    let bestPerformer: PortfolioPerformer | null = null;
    let worstPerformer: PortfolioPerformer | null = null;
    const ranked = known
      .filter((h) => Number(h.costBasis) > 0)
      .map((h) => ({
        cardId: h.cardId,
        name: h.name,
        returnPct: ((Number(h.value) - Number(h.costBasis)) / Number(h.costBasis)) * 100,
      }));
    if (ranked.length >= 2) {
      bestPerformer = ranked.reduce((a, b) => (a.returnPct >= b.returnPct ? a : b));
      worstPerformer = ranked.reduce((a, b) => (a.returnPct <= b.returnPct ? a : b));
    }

    // 12-month value history, synthesized from trade data (design Decision 4).
    const cardData = new Map<string, HistoryCardData>();
    for (const id of new Set([...tradesByCard.keys(), ...listingsByCard.keys()])) {
      cardData.set(id, {
        trades: tradesByCard.get(id) ?? [],
        listings: listingsByCard.get(id) ?? [],
      });
    }
    const history = buildHistory({
      monthEnds: monthEndsEndingAt(new Date()),
      cardData,
      buys,
      sells,
      liveTotal: totalValue,
    }).map((h) => ({ month: h.month, value: usd(h.value) }));

    const response: PortfolioResponse = {
      account,
      holdings,
      totalValue: usd(totalValue),
      totalCost: usd(totalCost),
      unrealizedGain: usd(unrealizedGain),
      unrealizedGainPct,
      rarity,
      bestPerformer,
      worstPerformer,
      history,
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

## Context

The portfolio page renders four metrics that all need real data: **holdings** (which
cards the wallet owns), **current value per card**, **cost basis per card**, and
**value history** (how the portfolio total has changed over time). The backend
already resolves on-chain holdings via `filterHeldCards` in `apps/api/src/stellar.ts`
(used by `GET /api/cards?owner=…`). The `trades` table records every settled trade
with `buyer`, `price_usdc`, `royalty_usdc`, `fee_usdc`, and `settled_at`, joined
through `listing_id → card_id`. The `listings` table has open listings with
`price_usdc` per card. No new indexing or background jobs are needed.

## Goals / Non-Goals

**Goals:**
- Provide a live `GET /api/portfolio?account=…` that returns everything the page
  needs in one round trip: holdings list with per-card value and cost, totals,
  allocation by rarity, best/worst performer, 12-month value-history series.
- Reuse the existing `filterHeldCards` holdings-resolution path — no duplication.
- Cost basis = the buyer price the account actually paid (from `trades.price_usdc`
  where `trades.buyer = account`); if no purchase trade exists (e.g. the card was
  minted directly to the account), cost basis defaults to zero.
- Per-card current value = most recent trade price for that card across all trades
  (market consensus), falling back to the lowest current open listing price, then
  falling back to zero (with a sentinel so the UI can show "unpriced").
- Compute a 12-month monthly value history from existing trade data; no snapshot
  table or background job.

**Non-Goals:**
- Realized P&L (cards the user sold) — out of scope; unrealized only.
- Multi-asset portfolios (all cards are priced in USDC).
- Historical cost tracking if the user bought the same card multiple times (use
  the most recent purchase trade as cost basis).
- Caching or materialized views — compute on-the-fly; the dataset is small enough
  for the hackathon.
- Pagination of the holdings list.

## Decisions

### Decision 1: Compute on-the-fly — no `portfolio_snapshots` table

**Chosen:** The portfolio endpoint computes everything from `cards`, `listings`,
and `trades` in a single request, with no background job or snapshot table.

**Why over a snapshot table:**
- The dataset is tiny for a hackathon (tens to low hundreds of cards, small user base).
- A daily snapshot job adds operational complexity (cron, failure recovery) for no
  meaningful performance win at this scale.
- The value-history series is synthesized from trade data (see Decision 4), which
  is already accurate and requires no additional write path.
- If the project scales beyond hackathon scope, snapshotting can be added later
  without changing the API contract — callers won't notice the swap.

**Risk:** at production scale (thousands of wallets, hundreds of cards), the
`filterHeldCards` step does N Horizon/RPC calls per held card. Acceptable now;
the risk is noted under Risks.

### Decision 2: Valuation waterfall — last trade price → lowest listing → zero

Per-card current value uses this priority order:

1. **Most recent settled trade price for this card** (any buyer/seller, newest
   `settled_at`). This is the actual market-clearing price — the last price
   someone paid. It's the most honest single-number proxy for market value.
2. **Lowest open listing price** for this card (`min(price_usdc)` over open
   listings). If a card has never traded but is currently on sale, the listing
   price is the best available signal.
3. **Zero** (with `valuedAt: null` in the response so the UI can show "—" instead
   of "$0.00"). Cards minted to a wallet but never traded or listed have no
   market signal.

**Why last trade over open listing as primary:**
Open listings are asks, not executed prices; they can be inflated or stale.
Executed trades are the real market signal. Using the newest trade avoids being
biased by a single old outlier when many trades exist.

### Decision 3: Cost basis from the account's own purchase trades

`cost_basis = price_usdc` of the most recent `trade` row where `buyer = account`
and the trade's `listing.card_id = card.id`. "Most recent" handles the edge case
where the same account bought the same card more than once (track what they paid
last). If no purchase trade exists, cost basis is `0` (flagged as `costBasisKnown:
false` in the response).

**Why not the listing price at purchase time:**
The listing price is what was asked; the `trade.price_usdc` is what was actually
paid (offer acceptance can settle at a different price if `accept_offer` is used
with a lower offer). The trade row is truth.

### Decision 4: 12-month value-history series — synthesize from trades

For each of the 12 prior months (ending at the current month):

1. Determine which cards the account held at end-of-month, approximated as: cards
   the account had bought (trade.buyer = account, settled_at ≤ month-end) minus
   cards they had sold (trade.seller = account, settled_at ≤ month-end).
2. For each held card at that point, apply the valuation waterfall using only
   trades and listings that existed at or before month-end (i.e. `settled_at ≤
   month-end` and `created_at ≤ month-end` for listings).
3. Sum to get that month's portfolio value.

**Trade-offs:**
- This is an approximation; for example it ignores minted-but-never-traded cards
  entering the portfolio before their first listing. Acceptable for the hackathon
  demo: history only matters for shape, not precision.
- Computing 12 months × N cards is still lightweight at this scale.
- The current month's value is the same as the live total, so the chart's last bar
  is always consistent with the headline number.

**Alternative considered — zero-pad history until the first trade:**
For a new user with no trades, all 12 months come back as `0`. The UI shows a
flat line, which is honest. No special casing needed.

### Decision 5: Allocation by rarity — value-weighted over live holdings

`allocation[rarity] = sum(value) for all holdings with that rarity / totalValue`.
Colors for the stacked bar are constants (`legendary: #e0a92e`, `epic: #7c3aed`,
`rare: #2d5bff`, `common: #13c06a`) — same as the existing `ALLOC_COLORS`. They
move from the `panels.ts` mock to the portfolio page component itself (or a
shared theme constant), since they're presentational, not data.

### Decision 6: Best/worst performer by unrealized return %

`return_pct = (value - cost) / cost * 100` for each holding where `costBasisKnown:
true`. Cards with unknown cost basis are excluded from best/worst ranking to avoid
trivially inflated returns. If no card has a known cost basis, the response omits
`bestPerformer` / `worstPerformer`.

## Risks / Trade-offs

- **[filterHeldCards is O(N) Horizon/RPC calls]** — For a large card catalogue
  and many wallets, the `C…` path does one RPC call per card. At hackathon scale
  (< 20 cards) this is ~20 parallel calls and takes under 500 ms. If the catalogue
  grows, memoize or batch.
- **[Cost basis is $0 for minted cards]** — Cards distributed directly by the
  platform issuer (not purchased on the secondary market) will show `costBasisKnown:
  false` and a $0 cost basis. P&L will show the full value as gain. This is
  accurate (there was no purchase cost) but may look odd. The UI should display
  "N/A" rather than "+∞%" for these.
- **[History approximation ignores minted cards]** — The historical holds
  calculation only tracks buy/sell trades, not mints. A card airdropped into a
  wallet appears to have $0 value in historical months. Acceptable for demo.
- **[Stale listing prices]** — If a listing is open but the card has also traded
  since the listing was created, the listing price won't be used (trade price
  takes precedence). If the listing is cancelled before the endpoint is called,
  the fallback correctly drops to zero.
- **[Concurrent request amplification]** — Many simultaneous portfolio requests
  could hit Horizon hard. For the hackathon, this is not a concern; add a response
  cache or CDN layer before production.

## Migration Plan

No DB migration required. The endpoint is additive; no existing tables are altered.
The portfolio page change and mock removal are a pure UI change; no deployment
sequencing is needed beyond merging the PR.

## Open Questions

- Should the response include cards the account currently has *listed for sale*
  (they still own them until sold)? Current lean: **yes**, include them — they
  are still holdings until settled — but mark `listed: true` so the UI can show
  a "listed" badge.
- Value history period: 12 months is chosen; should it be adjustable (3M / 6M /
  1Y) via a query param? Current lean: **no**, fix at 12 months for the MVP, add
  a `range` param later.

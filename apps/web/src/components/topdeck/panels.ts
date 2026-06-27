/**
 * TopDeck — shared static design data for the display panels.
 *
 * The leaderboard, portfolio, and trade flows are now backed by real data:
 *  - leaderboard: `GET /api/leaderboard` (`LeaderboardBoard`/`LeaderboardRow`)
 *  - portfolio: `GET /api/portfolio` (`PortfolioResponse`)
 *  - trade: real holdings (`GET /api/cards?owner=`) + live listings, with
 *    proposals persisted via `/api/trade-proposals` (`TradeProposal`).
 * The former static `LB_*`, `PF_*`, and `MY_CARDS`/`TradeItem`/`TradeState`/
 * `EMPTY_TRADE` fixtures and their types were removed with those changes.
 */

/** Gradient avatars reused across leaderboard rows, reviews, and podium. */
export const G = {
  g1: 'linear-gradient(135deg,#ff4d3d,#ffb83d)',
  g2: 'linear-gradient(135deg,#2d5bff,#3ff0ff)',
  g3: 'linear-gradient(135deg,#7c3aed,#c77dff)',
  g4: 'linear-gradient(135deg,#13c06a,#7affb0)',
  g5: 'linear-gradient(135deg,#ff4d9d,#ff8edb)',
  g6: 'linear-gradient(135deg,#94a0b3,#d4dae3)',
  g7: 'linear-gradient(135deg,#3a2bd0,#7c6bff)',
  g8: 'linear-gradient(135deg,#e0a92e,#ffe27a)',
  g9: 'linear-gradient(135deg,#0a5e34,#13c06a)',
  g10: 'linear-gradient(135deg,#a3160a,#ff4d3d)',
} as const;

/**
 * TopDeck — static design data for the display panels (Leaderboard, Portfolio,
 * Profile, Trade). These screens have no backend in the fixed-price marketplace,
 * so — exactly like `mockCards` for the browse grid — they render prototype data
 * ported 1:1 from the Claude Design source (TopDeck.dc.html). The Trade flow's
 * "you give" side draws from MY_CARDS; the "you get" side draws from live cards.
 */

import type { Rarity } from './lib';

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

// ===== Leaderboard =====
export type LbTab = 'collectors' | 'sellers' | 'traders';

export interface LbUser {
  name: string;
  art: string;
  value: number;
  cards: number;
  win: string;
  salesVol: number;
  sales: number;
  rating: string;
  profit: number;
  flips: number;
  roi: string;
  /** Season rank change vs. last week (positive = climbing). */
  delta: number;
  tag: string;
}

export const LB_USERS: LbUser[] = [
  { name: 'GoldenEraCards', art: G.g8, value: 612400, cards: 1180, win: '69%', salesVol: 142300, sales: 4610, rating: '5.0', profit: 88200, flips: 690, roi: '+31%', delta: 0, tag: 'Vintage vault' },
  { name: 'VaultKings', art: G.g1, value: 498250, cards: 1240, win: '71%', salesVol: 201800, sales: 3204, rating: '4.9', profit: 124600, flips: 410, roi: '+44%', delta: 2, tag: 'PSA whale' },
  { name: 'HoloHaven', art: G.g5, value: 421900, cards: 870, win: '66%', salesVol: 98700, sales: 2055, rating: '4.9', profit: 61300, flips: 330, roi: '+27%', delta: -1, tag: 'Holo hunter' },
  { name: 'Cooperstown Co', art: G.g6, value: 388600, cards: 540, win: '73%', salesVol: 176400, sales: 5781, rating: '5.0', profit: 71900, flips: 880, roi: '+22%', delta: 1, tag: 'Sports legend' },
  { name: 'PrismPalace', art: G.g3, value: 295300, cards: 1620, win: '58%', salesVol: 64200, sales: 877, rating: '4.8', profit: 48700, flips: 210, roi: '+19%', delta: -2, tag: 'Prism stacker' },
  { name: 'DragonHoard', art: G.g10, value: 268400, cards: 430, win: '62%', salesVol: 54900, sales: 612, rating: '4.7', profit: 96500, flips: 520, roi: '+52%', delta: 3, tag: 'Aggro flipper' },
  { name: 'RookieRack', art: G.g2, value: 214700, cards: 760, win: '60%', salesVol: 88300, sales: 1338, rating: '4.7', profit: 39800, flips: 300, roi: '+18%', delta: 0, tag: 'Rookie radar' },
  { name: 'PullRatePro', art: G.g4, value: 182500, cards: 2240, win: '55%', salesVol: 43100, sales: 912, rating: '4.8', profit: 33400, flips: 180, roi: '+24%', delta: 1, tag: 'Box ripper' },
  { name: 'foilfiend', art: G.g7, value: 156900, cards: 980, win: '57%', salesVol: 31200, sales: 455, rating: '4.6', profit: 28900, flips: 160, roi: '+21%', delta: -1, tag: 'Foil fiend' },
  { name: 'shinyhunter', art: G.g9, value: 138200, cards: 1340, win: '59%', salesVol: 27800, sales: 388, rating: '4.6', profit: 25600, flips: 140, roi: '+17%', delta: 2, tag: 'Shiny seeker' },
];

export const LB_CFGS: Record<LbTab, { key: keyof LbUser; label: string; sub: (u: LbUser) => string }> = {
  collectors: { key: 'value', label: 'COLLECTION VALUE', sub: (u) => u.cards.toLocaleString() + ' cards · ' + u.win + ' win rate' },
  sellers: { key: 'salesVol', label: 'SOLD · 90 DAYS', sub: (u) => u.sales.toLocaleString() + ' sales · ★' + u.rating },
  traders: { key: 'profit', label: 'PROFIT · ALL-TIME', sub: (u) => u.flips + ' flips · ' + u.roi + ' ROI' },
};

export const LB_SUBTITLE: Record<LbTab, string> = {
  collectors: 'Ranked by total collection value this season.',
  sellers: 'Ranked by 90-day sales volume.',
  traders: 'Ranked by all-time realized profit.',
};

/** The signed-in user's standing per tab (rank #47 across the board). */
export const LB_YOU: Record<LbTab, { value: number; sub: string }> = {
  collectors: { value: 28400, sub: '212 cards · 54% win rate' },
  sellers: { value: 9200, sub: '96 sales · ★4.7' },
  traders: { value: 6100, sub: '38 flips · +23% ROI' },
};

// ===== Portfolio =====
export interface PfHolding {
  name: string;
  rarity: Rarity;
  cost: number;
  value: number;
}

export const PF_RAW: PfHolding[] = [
  { name: 'Solar Drake · 1st Ed', rarity: 'legendary', cost: 1800, value: 2450 },
  { name: 'Aurora Phoenix Holo', rarity: 'legendary', cost: 2400, value: 3120 },
  { name: 'Retro Slugger Gold', rarity: 'legendary', cost: 5800, value: 7300 },
  { name: "Vintage Slugger '52", rarity: 'epic', cost: 4200, value: 5900 },
  { name: 'Galaxy Mage Prism', rarity: 'epic', cost: 1100, value: 940 },
  { name: 'Chrome Rookie', rarity: 'rare', cost: 520, value: 410 },
  { name: 'Neon Striker', rarity: 'rare', cost: 120, value: 180 },
];

/** Historical monthly value; the final month is replaced with the live total. */
export const PF_HIST_VALS = [12800, 13600, 13100, 15200, 16400, 15900, 18700];
export const PF_HIST_LABELS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

export const ALLOC_COLORS: Record<Rarity, string> = {
  legendary: '#e0a92e',
  epic: '#7c3aed',
  rare: '#2d5bff',
  common: '#13c06a',
};

// ===== Profile =====
export interface ProfileData {
  username: string;
  bio: string;
  location: string;
  website: string;
  memberSince: string;
  notifyOutbid: boolean;
  notifyEnding: boolean;
  notifySales: boolean;
  publicCollection: boolean;
}

export const DEFAULT_PROFILE: ProfileData = {
  username: 'cardwizard_88',
  bio: 'Vintage Pokémon and 90s sports. Always hunting clean copies and fair trades.',
  location: 'Portland, OR',
  website: 'topdeck.gg/cardwizard',
  memberSince: '2021',
  notifyOutbid: true,
  notifyEnding: true,
  notifySales: true,
  publicCollection: true,
};

export const PROFILE_STATS: Array<{ v: string; l: string }> = [
  { v: '$28,400', l: 'Collection value' },
  { v: '212', l: 'Cards owned' },
  { v: '96', l: 'Cards sold' },
  { v: '★ 4.7', l: 'Seller rating' },
  { v: '54%', l: 'Win rate' },
];

export interface Achievement {
  icon: string;
  name: string;
  desc: string;
  got: boolean;
  bg: string;
}

export const PROFILE_ACHIEVEMENTS: Achievement[] = [
  { icon: '🏆', name: 'First win', desc: 'Won your first auction', got: true, bg: '#ffd84d' },
  { icon: '💯', name: 'Century club', desc: '100+ cards collected', got: true, bg: '#bff3d4' },
  { icon: '🛡', name: 'Vault verified', desc: 'Identity authenticated', got: true, bg: '#cfe0ff' },
  { icon: '⭐', name: '5-star seller', desc: '50 reviews at 4.5+', got: true, bg: '#ffe0d6' },
  { icon: '🔥', name: '30-day streak', desc: 'Active a month straight', got: true, bg: '#ffd1cc' },
  { icon: '💎', name: 'Top 50 collector', desc: 'Reach the season top 50', got: true, bg: '#e7ddff' },
  { icon: '🐋', name: 'Big spender', desc: '$10k in a single bid', got: false, bg: '#fff' },
  { icon: '👑', name: 'Season champion', desc: 'Finish #1 in a season', got: false, bg: '#fff' },
];

export const PROFILE_ACTIVITY: Array<{ icon: string; iconBg: string; text: string; amt: string; when: string }> = [
  { icon: '🏆', iconBg: '#bff3d4', text: 'Won Aurora Phoenix Holo', amt: '$3,120', when: '2h ago' },
  { icon: '⚡', iconBg: '#ffd1cc', text: 'Outbid on Galaxy Mage Prism', amt: '$940', when: '5h ago' },
  { icon: '🔨', iconBg: '#ffd84d', text: 'Listed Chrome Rookie for auction', amt: '$410', when: '1d ago' },
  { icon: '💸', iconBg: '#bff3d4', text: 'Sold Pixel Familiar', amt: '$40', when: '2d ago' },
  { icon: '♥', iconBg: '#ffe0d6', text: 'Added Retro Slugger Gold to watchlist', amt: '$7,300', when: '3d ago' },
  { icon: '🎴', iconBg: '#cfe0ff', text: 'Bid on Solar Drake · 1st Ed', amt: '$2,450', when: '4d ago' },
];

export const PROFILE_REVIEWS: Array<{ name: string; art: string; stars: string; text: string; when: string }> = [
  { name: 'VaultKings', art: G.g1, stars: '★★★★★', text: 'Fast shipping, card exactly as described. A+ trader.', when: '1w ago' },
  { name: 'PullRatePro', art: G.g4, stars: '★★★★★', text: 'Smooth deal and great communication throughout.', when: '3w ago' },
  { name: 'RookieRack', art: G.g2, stars: '★★★★☆', text: 'Good buyer — minor delay on payment but all sorted.', when: '1mo ago' },
];

// ===== Trade =====
export interface MyCard {
  id: string;
  name: string;
  rarity: Rarity;
  value: number;
  grade: string;
}

/** The signed-in user's holdings — the pool for the Trade "you give" side. */
export const MY_CARDS: MyCard[] = [
  { id: 'm1', name: 'Solar Drake · 1st Ed', rarity: 'legendary', value: 2450, grade: 'PSA 10' },
  { id: 'm2', name: 'Aurora Phoenix Holo', rarity: 'legendary', value: 3120, grade: 'PSA 9' },
  { id: 'm3', name: "Vintage Slugger '52", rarity: 'epic', value: 5900, grade: 'SGC 9' },
  { id: 'm4', name: 'Galaxy Mage Prism', rarity: 'epic', value: 940, grade: 'PSA 8' },
  { id: 'm5', name: 'Chrome Rookie', rarity: 'rare', value: 410, grade: 'BGS 9' },
  { id: 'm6', name: 'Neon Striker', rarity: 'rare', value: 180, grade: 'Raw' },
  { id: 'm7', name: 'Pixel Familiar', rarity: 'common', value: 40, grade: 'Raw' },
  { id: 'm8', name: 'Retro Slugger Gold', rarity: 'legendary', value: 7300, grade: 'BGS 9.5' },
];

/** A card on either side of a trade (give = your holdings, get = live listings). */
export interface TradeItem {
  id: string;
  name: string;
  rarity: Rarity;
  value: number;
  grade: string;
  /** Present for "you get" cards (the listing's seller); absent for your own. */
  seller?: string;
}

export interface TradeState {
  give: string[];
  get: string[];
  cash: string;
  picker: 'give' | 'get' | null;
  sent: boolean;
}

export const EMPTY_TRADE: TradeState = { give: [], get: [], cash: '', picker: null, sent: false };

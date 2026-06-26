/**
 * TopDeck design — shared helpers, types, and the mapping that turns real
 * marketplace listings into the auction-card shape the UI renders.
 *
 * The visual model is an auction house (current bid / timers / bid history).
 * The backend is a fixed-price USDC marketplace, so the auction-specific fields
 * (endsAt, bids) are *simulated* on top of real listing data. Wallet connect,
 * the browse grid, and the Sell publish flow all use the real API.
 */

import type { Card, Listing } from '@cardmkt/shared';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Bid {
  bidder: string;
  amount: number;
  /** Relative age in ms (mock seed data). */
  ago?: number;
  /** Absolute timestamp (live, client-placed bids). */
  at?: number;
  you?: boolean;
}

export interface TopCard {
  id: string;
  name: string;
  rarity: Rarity;
  condition: string;
  grade: string;
  cats: string[];
  /** CSS background shorthand — a gradient or a `center/cover url(...)`. */
  art: string;
  /** Original image URL, when the card came from a real listing. */
  image?: string;
  sellerArt: string;
  currentBid: number;
  endsAt: number;
  buyNow: number;
  seller: string;
  sellerRating: string;
  sellerSales: string;
  setLine: string;
  bids: Bid[];
  /** True when this card is backed by a real on-chain listing. */
  real?: boolean;
  /** Real listing id (uuid) — present when `real`. */
  listingId?: string;
  /** Real card id (uuid) — present when `real` or self-listed. */
  cardId?: string;
  /** True for the connected user's own listings (drives the Selling tab). */
  mine?: boolean;
  /** Creator royalty in basis points, paid to the card's creator on resale. */
  royaltyBps?: number;
}

const H = 3600000;

export function money(n: number): string {
  return '$' + Math.round(n).toLocaleString();
}

export function increment(v: number): number {
  if (v < 100) return 5;
  if (v < 1000) return 25;
  if (v < 5000) return 100;
  return 250;
}

export function rarityMeta(r: Rarity): { label: string; bg: string; color: string } {
  if (r === 'legendary') return { label: 'LEGENDARY', bg: '#1a1305', color: '#ffd84d' };
  if (r === 'epic') return { label: 'EPIC', bg: '#7c3aed', color: '#fff' };
  if (r === 'rare') return { label: 'RARE', bg: '#2d5bff', color: '#fff' };
  return { label: 'COMMON', bg: '#fff', color: '#1a1305' };
}

export function rarityArt(r: Rarity): string {
  if (r === 'legendary') return 'linear-gradient(150deg,#ffb83d,#ff4d3d)';
  if (r === 'epic') return 'linear-gradient(150deg,#c77dff,#7c3aed)';
  if (r === 'rare') return 'linear-gradient(150deg,#3ff0ff,#2d5bff)';
  return 'linear-gradient(150deg,#7affb0,#13c06a)';
}

export function rarityDot(r: Rarity): string {
  if (r === 'legendary') return '#e0a92e';
  if (r === 'epic') return '#7c3aed';
  if (r === 'rare') return '#2d5bff';
  return '#13c06a';
}

export function fmtLeft(ms: number): string {
  if (ms <= 0) return 'ENDED';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return d + 'd ' + p(h) + 'h';
  return p(h) + ':' + p(m) + ':' + p(ss);
}

export function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return h + 'h ago';
  if (m > 0) return m + 'm ago';
  return Math.max(1, s) + 's ago';
}

export function mapRarity(r: string): Rarity {
  const v = (r || '').toLowerCase();
  if (v === 'legendary') return 'legendary';
  if (v === 'epic') return 'epic';
  if (v === 'rare') return 'rare';
  return 'common';
}

/** Real cards carry no auction category — bucket everything as "Other". */
export function categoryFor(_card: Card): string {
  return 'Other';
}

export function shorten(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * Deterministic auction end time for a real listing. A hash of the id picks a
 * stable offset so the countdown is consistent for a given listing within a
 * session (seeded once, at fetch time).
 */
function simulatedEndsAt(id: string, base: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const minutes = 20 + (h % (48 * 60)); // 20 min … 48 h out
  return base + minutes * 60000;
}

/** Turn a real on-chain listing into the auction-card shape the UI renders. */
export function mapListing(l: Listing, base = Date.now()): TopCard {
  const card = l.card!;
  const rarity = mapRarity(card.rarity);
  const price = Number(l.priceUsdc) || 0;
  return {
    id: l.id,
    listingId: l.id,
    cardId: l.cardId,
    real: true,
    name: card.name,
    rarity,
    condition: card.set,
    grade: 'Raw',
    cats: [categoryFor(card)],
    art: card.imageUrl ? `center/cover no-repeat url("${card.imageUrl}")` : rarityArt(rarity),
    image: card.imageUrl,
    sellerArt: rarityArt(rarity),
    currentBid: price,
    endsAt: simulatedEndsAt(l.id, base),
    buyNow: price,
    seller: shorten(l.seller),
    sellerRating: '—',
    sellerSales: '0',
    setLine: (card.set || 'LISTING').toUpperCase(),
    bids: [],
    royaltyBps: card.royaltyBps ?? 0,
  };
}

/**
 * Branded demo cards shown when the API is unreachable or has no open listings,
 * so the marketplace is never empty. Mirrors the original design's sample lots.
 */
export function mockCards(base = Date.now()): TopCard[] {
  const S = 1000,
    M = 60000;
  const seed: Array<Omit<TopCard, 'endsAt'> & { endsIn: number }> = [
    {
      id: 'drake', name: 'Solar Drake · 1st Ed', rarity: 'legendary', condition: 'PSA 10 · Gem Mint',
      grade: 'PSA 10', cats: ['Pokémon', 'Graded'], art: 'linear-gradient(150deg,#ffb83d,#ff4d3d)',
      sellerArt: 'linear-gradient(135deg,#ff4d3d,#ffb83d)', currentBid: 2450, endsIn: 2 * H + 14 * M,
      buyNow: 3800, seller: 'VaultKings', sellerRating: '4.9', sellerSales: '3,204', setLine: 'BASE SET · #006 / 102',
      bids: [
        { bidder: 'cardwizard_88', amount: 2450, ago: 120 * S },
        { bidder: 'DragonHoard', amount: 2300, ago: 9 * M },
        { bidder: 'mintcondition', amount: 2100, ago: 24 * M },
        { bidder: 'cardwizard_88', amount: 1900, ago: 51 * M },
      ],
    },
    {
      id: 'striker', name: 'Neon Striker', rarity: 'rare', condition: 'Near Mint', grade: 'Raw',
      cats: ['Pokémon'], art: 'linear-gradient(150deg,#3ff0ff,#2d5bff)',
      sellerArt: 'linear-gradient(135deg,#2d5bff,#3ff0ff)', currentBid: 180, endsIn: 42 * M, buyNow: 0,
      seller: 'PullRatePro', sellerRating: '4.8', sellerSales: '912', setLine: 'NEON GENESIS · #045 / 188',
      bids: [
        { bidder: 'sleeve_king', amount: 180, ago: 3 * M },
        { bidder: 'tcg_tom', amount: 165, ago: 14 * M },
        { bidder: 'sleeve_king', amount: 140, ago: 38 * M },
      ],
    },
    {
      id: 'slugger', name: "Vintage Slugger '52", rarity: 'epic', condition: 'SGC 9 · Mint', grade: 'SGC 9',
      cats: ['Sports', 'Graded'], art: 'linear-gradient(150deg,#c77dff,#7c3aed)',
      sellerArt: 'linear-gradient(135deg,#7c3aed,#c77dff)', currentBid: 5900, endsIn: 28 * H, buyNow: 0,
      seller: 'Cooperstown Co', sellerRating: '5.0', sellerSales: '5,781', setLine: 'TOPPS 1952 · #311',
      bids: [
        { bidder: 'diamondhands', amount: 5900, ago: 42 * M },
        { bidder: 'vintage_vic', amount: 5500, ago: 3 * H },
        { bidder: 'diamondhands', amount: 5100, ago: 7 * H },
      ],
    },
    {
      id: 'familiar', name: 'Pixel Familiar', rarity: 'common', condition: 'Lightly Played', grade: 'Raw',
      cats: ['Pokémon'], art: 'linear-gradient(150deg,#7affb0,#13c06a)',
      sellerArt: 'linear-gradient(135deg,#13c06a,#7affb0)', currentBid: 24, endsIn: 3 * H + 11 * M, buyNow: 40,
      seller: 'BulkBinBets', sellerRating: '4.6', sellerSales: '421', setLine: '8-BIT SAGA · #112 / 200',
      bids: [
        { bidder: 'pennypincher', amount: 24, ago: 18 * M },
        { bidder: 'starter_deck', amount: 18, ago: 55 * M },
      ],
    },
    {
      id: 'phoenix', name: 'Aurora Phoenix Holo', rarity: 'legendary', condition: 'PSA 9 · Mint', grade: 'PSA 9',
      cats: ['Pokémon', 'Graded'], art: 'linear-gradient(150deg,#ff8edb,#ff4d9d)',
      sellerArt: 'linear-gradient(135deg,#ff4d9d,#ff8edb)', currentBid: 3120, endsIn: 9 * M + 44 * S, buyNow: 4500,
      seller: 'HoloHaven', sellerRating: '4.9', sellerSales: '2,055', setLine: 'CELESTIAL · #199 / 199',
      bids: [
        { bidder: 'shinyhunter', amount: 3120, ago: 50 * S },
        { bidder: 'DragonHoard', amount: 2950, ago: 6 * M },
        { bidder: 'foilfiend', amount: 2700, ago: 19 * M },
      ],
    },
    {
      id: 'chrome', name: 'Chrome Rookie', rarity: 'rare', condition: 'Mint · Graded', grade: 'BGS 9',
      cats: ['Sports', 'Graded'], art: 'linear-gradient(150deg,#d4dae3,#94a0b3)',
      sellerArt: 'linear-gradient(135deg,#94a0b3,#d4dae3)', currentBid: 410, endsIn: 5 * H + 27 * M, buyNow: 650,
      seller: 'RookieRack', sellerRating: '4.7', sellerSales: '1,338', setLine: 'CHROME PRIZM · #88',
      bids: [
        { bidder: 'courtside', amount: 410, ago: 22 * M },
        { bidder: 'rookie_radar', amount: 360, ago: 2 * H },
      ],
    },
    {
      id: 'mage', name: 'Galaxy Mage Prism', rarity: 'epic', condition: 'PSA 8 · NM-Mint', grade: 'PSA 8',
      cats: ['Pokémon', 'Graded'], art: 'linear-gradient(150deg,#7c6bff,#3a2bd0)',
      sellerArt: 'linear-gradient(135deg,#3a2bd0,#7c6bff)', currentBid: 940, endsIn: 28 * M, buyNow: 1400,
      seller: 'PrismPalace', sellerRating: '4.8', sellerSales: '877', setLine: 'COSMIC ECLIPSE · #155 / 155',
      bids: [
        { bidder: 'arcanist', amount: 940, ago: 4 * M },
        { bidder: 'spellslinger', amount: 880, ago: 16 * M },
      ],
    },
    {
      id: 'gold', name: 'Retro Slugger Gold', rarity: 'legendary', condition: 'BGS 9.5 · Gem', grade: 'BGS 9.5',
      cats: ['Sports', 'Graded'], art: 'linear-gradient(150deg,#ffe27a,#e0a92e)',
      sellerArt: 'linear-gradient(135deg,#e0a92e,#ffe27a)', currentBid: 7300, endsIn: 6 * H + 8 * M, buyNow: 0,
      seller: 'GoldenEraCards', sellerRating: '5.0', sellerSales: '4,610', setLine: 'MINT GOLD REFRACTOR · 04 / 10',
      bids: [
        { bidder: 'hoftracker', amount: 7300, ago: 33 * M },
        { bidder: 'goldglove', amount: 6800, ago: 4 * H },
      ],
    },
  ];
  return seed.map(({ endsIn, ...c }) => ({ ...c, endsAt: base + endsIn }));
}

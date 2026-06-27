/**
 * TopDeck design — shared helpers, types, and the mapping that turns real
 * marketplace listings into the auction-card shape the UI renders.
 *
 * The visual model is an auction house (current bid / timers / bid history).
 * The backend is a fixed-price USDC marketplace, so the auction-specific fields
 * (endsAt, bids) are *simulated* on top of real listing data. Wallet connect,
 * the browse grid, and the Sell publish flow all use the real API.
 */

import type { Card, Fulfillment, Listing } from '@cardmkt/shared';

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
  /** On-chain settlement-contract listing id — needed for passkey buy_now. */
  contractListingId?: number | null;
  /** Real card id (uuid) — present when `real` or self-listed. */
  cardId?: string;
  /** True for the connected user's own listings (drives the Selling tab). */
  mine?: boolean;
  /** Creator royalty in basis points, paid to the card's creator on resale. */
  royaltyBps?: number;
  /**
   * How a real listing settles: `digital` (instant atomic swap) or `physical`
   * (delivery-confirmation escrow). Absent on mock/demo cards.
   */
  fulfillment?: Fulfillment;
}

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
    contractListingId: l.contractListingId,
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
    fulfillment: l.fulfillment,
  };
}


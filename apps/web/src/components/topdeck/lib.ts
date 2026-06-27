/**
 * TopDeck design — shared helpers, types, and the mapping that turns real
 * marketplace listings into the auction-card shape the UI renders.
 *
 * The visual model is an auction house (current bid / timers / bid history).
 * The backend is a fixed-price USDC marketplace, so the auction-specific fields
 * (endsAt, bids) are *simulated* on top of real listing data. Wallet connect,
 * the browse grid, and the Sell publish flow all use the real API.
 */

import type { Auction, Bid as ApiBid, Card, Fulfillment, Listing } from '@cardmkt/shared';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Bid {
  bidder: string;
  amount: number;
  /** Absolute timestamp the bid was placed. */
  at?: number;
  /** This bid was superseded by a higher one (drives the muted treatment). */
  outbid?: boolean;
  /** True when the connected wallet placed this bid. */
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
  /** Real listing id (uuid) — present when `real` and not an auction. */
  listingId?: string;
  /** On-chain settlement-contract listing id — needed for passkey buy_now. */
  contractListingId?: number | null;
  /** True when this card is a timed auction rather than a fixed-price listing. */
  isAuction?: boolean;
  /** Real auction id (uuid) — present when `isAuction`. */
  auctionId?: string;
  /** On-chain settlement-contract auction id — needed for bid/settle/cancel. */
  contractAuctionId?: number | null;
  /** Auction status, present when `isAuction`. */
  auctionStatus?: Auction['status'];
  /** Current high bidder's address (auction only). */
  highBidder?: string | null;
  /** Seller's full Stellar address (auctions need it for self-bid checks). */
  sellerAddress?: string;
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

/** Turn a real on-chain fixed-price listing into the card shape the UI renders. */
export function mapListing(l: Listing): TopCard {
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
    // Fixed-price listings have no countdown; `0` means "no auction timer".
    endsAt: 0,
    buyNow: price,
    seller: shorten(l.seller),
    sellerAddress: l.seller,
    sellerRating: '—',
    sellerSales: '0',
    setLine: (card.set || 'LISTING').toUpperCase(),
    bids: [],
    royaltyBps: card.royaltyBps ?? 0,
    fulfillment: l.fulfillment,
  };
}

/** Map an API bid row into the UI bid shape. */
export function mapBid(b: ApiBid, you?: string): Bid {
  return {
    bidder: shorten(b.bidder),
    amount: Number(b.amountUsdc) || 0,
    at: new Date(b.createdAt).getTime(),
    outbid: b.outbidAt != null,
    you: you != null && b.bidder === you,
  };
}

/**
 * Turn a real on-chain auction into the auction-card shape the UI renders. The
 * countdown derives from the real `endsAt`; `currentBid` is the high bid (or the
 * start price before any bids). `bids` are populated from the bids API.
 */
export function mapAuction(a: Auction, bids: ApiBid[] = [], you?: string): TopCard {
  const card = a.card!;
  const rarity = mapRarity(card.rarity);
  const high = Number(a.highBidUsdc) || 0;
  const start = Number(a.startPriceUsdc) || 0;
  return {
    id: a.id,
    auctionId: a.id,
    contractAuctionId: a.contractAuctionId,
    isAuction: true,
    auctionStatus: a.status,
    highBidder: a.highBidder,
    cardId: a.cardId,
    real: true,
    name: card.name,
    rarity,
    condition: card.set,
    grade: 'Raw',
    cats: [categoryFor(card)],
    art: card.imageUrl ? `center/cover no-repeat url("${card.imageUrl}")` : rarityArt(rarity),
    image: card.imageUrl,
    sellerArt: rarityArt(rarity),
    currentBid: high > 0 ? high : start,
    endsAt: new Date(a.endsAt).getTime(),
    // Auctions have no buy-now price.
    buyNow: 0,
    seller: shorten(a.seller),
    sellerAddress: a.seller,
    sellerRating: '—',
    sellerSales: '0',
    setLine: (card.set || 'AUCTION').toUpperCase(),
    bids: bids.map((b) => mapBid(b, you)),
    royaltyBps: card.royaltyBps ?? 0,
  };
}


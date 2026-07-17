/**
 * Reset marketplace demo data.
 *
 * Cards are NFTs in the global collection contract now, so card rows are no
 * longer seeded here — a card only exists once it is minted on-chain through
 * the API (`POST /api/cards/mint`; the scripts package's `demo.ts` does this).
 * This script just clears the mirror tables in FK order so a fresh
 * deploy + demo run starts from an honest, empty state.
 */

import { db, queryClient } from './client.js';
import {
  auctions,
  bids,
  cardComments,
  cardCopies,
  cardReviews,
  cards,
  listings,
  offers,
  orders,
  reviews,
  trades,
  tradeProposals,
  watchlist,
} from './schema.js';

async function main() {
  console.log('[seed] clearing demo data (cards are minted via the API now)...');
  // Children before parents so no FK trips.
  await db.delete(watchlist);
  await db.delete(bids);
  await db.delete(auctions);
  await db.delete(reviews);
  await db.delete(trades);
  await db.delete(orders);
  await db.delete(offers);
  await db.delete(listings);
  await db.delete(tradeProposals);
  await db.delete(cardReviews);
  await db.delete(cardComments);
  await db.delete(cardCopies);
  await db.delete(cards);

  console.log('[seed] done — run the scripts package `demo` to mint + list cards.');
  await queryClient.end();
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await queryClient.end();
  process.exit(1);
});

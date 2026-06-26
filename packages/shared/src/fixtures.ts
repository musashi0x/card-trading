/**
 * Canonical sample card catalog — shared demo reference data.
 *
 * Single source of truth used by on-chain issuance (@cardmkt/scripts) and the
 * DB seed (@cardmkt/db). `slug` derives the Stellar asset code via the codec.
 */

export interface CardFixture {
  slug: string;
  name: string;
  set: string;
  rarity: string;
  imageUrl: string;
  supply: number;
  /**
   * Creator royalty in basis points, paid on every resale. The creator payout
   * account is created at setup time and registered via `set_royalty`; here we
   * only fix the rate per card. 0 means no royalty.
   */
  royaltyBps: number;
}

export const CARD_FIXTURES: CardFixture[] = [
  {
    slug: 'NOVA',
    name: 'Nova Dragon',
    set: 'Genesis',
    rarity: 'Legendary',
    imageUrl: 'https://images.unsplash.com/photo-1640955014216-75201056c829?w=600',
    supply: 5,
    royaltyBps: 500, // 5%
  },
  {
    slug: 'EMBER',
    name: 'Ember Fox',
    set: 'Genesis',
    rarity: 'Rare',
    imageUrl: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=600',
    supply: 25,
    royaltyBps: 300, // 3%
  },
  {
    slug: 'TIDE',
    name: 'Tidecaller',
    set: 'Genesis',
    rarity: 'Rare',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600',
    supply: 25,
    royaltyBps: 300, // 3%
  },
  {
    slug: 'GROVE',
    name: 'Grove Sentinel',
    set: 'Verdant',
    rarity: 'Uncommon',
    imageUrl: 'https://images.unsplash.com/photo-1614851099175-e5b30eb6f696?w=600',
    supply: 100,
    royaltyBps: 0, // no royalty
  },
  {
    slug: 'STORM',
    name: 'Stormcaller',
    set: 'Verdant',
    rarity: 'Epic',
    imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600',
    supply: 10,
    royaltyBps: 500, // 5%
  },
  {
    slug: 'VOID',
    name: 'Void Walker',
    set: 'Eclipse',
    rarity: 'Legendary',
    imageUrl: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=600',
    supply: 5,
    royaltyBps: 500, // 5%
  },
];

/**
 * Seed demo cards + open listings.
 *
 * Cards are NFTs in the global collection contract: this script mints every
 * shared card fixture through the API (server-signed collection mints), then
 * lists a few merchant copies so the marketplace shows open listings on first
 * load. Royaltied cards pay the demo creator wallet; VOID is minted to the
 * creator itself so a primary sale (seller == creator, no royalty) stays
 * demonstrable. Run after setup/deploy/seed with the API up.
 *
 * Run: `pnpm --filter @cardmkt/scripts run demo`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { CARD_FIXTURES } from '@cardmkt/shared';

const API = process.env.API_URL ?? 'http://localhost:4000';
const ROOT = resolve(process.cwd(), '../..');
const accounts = JSON.parse(readFileSync(resolve(ROOT, 'stellar-accounts.json'), 'utf8'));
const merchant = Keypair.fromSecret(accounts.merchant.secret);
const creatorPk = accounts.creator.publicKey as string;

const LISTINGS = [
  { slug: 'STORM', price: '75' },
  { slug: 'GROVE', price: '15' },
];

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`);
  return res.json();
}

/** Mint a fixture if no card with its name exists yet; return the card id. */
async function ensureCard(fixture: (typeof CARD_FIXTURES)[number]): Promise<string> {
  const cards = (await get('/api/cards')) as any[];
  const existing = cards.find((c) => c.name === fixture.name);
  if (existing) return existing.id;

  // VOID belongs to the creator (primary-sale demo); everything else to the
  // merchant, with royalties flowing to the separate creator wallet.
  const owner = fixture.slug === 'VOID' ? creatorPk : merchant.publicKey();
  const minted = await post('/api/cards/mint', {
    owner,
    name: fixture.name,
    set: fixture.set,
    rarity: fixture.rarity.toLowerCase(),
    imageUrl: fixture.imageUrl,
    supply: Math.min(fixture.supply, 3),
    royaltyBps: fixture.royaltyBps,
    creatorAccount: fixture.royaltyBps > 0 ? creatorPk : undefined,
  });
  console.log(
    `minted ${fixture.slug} (${fixture.name}) x${minted.copies.length} -> ${owner === creatorPk ? 'creator' : 'merchant'}`,
  );
  return minted.card.id;
}

async function main() {
  const cardIds = new Map<string, string>();
  for (const fixture of CARD_FIXTURES) {
    cardIds.set(fixture.slug, await ensureCard(fixture));
  }

  for (const { slug, price } of LISTINGS) {
    const cardId = cardIds.get(slug);
    if (!cardId) continue;
    const copies = (await get(
      `/api/cards/${cardId}/copies?owner=${merchant.publicKey()}`,
    )) as any[];
    const copy = copies[0];
    if (!copy) {
      console.log(`no merchant copy of ${slug} to list, skipping`);
      continue;
    }
    const built = await post('/api/tx/list', {
      cardCopyId: copy.id,
      seller: merchant.publicKey(),
      priceUsdc: price,
    });
    const tx = TransactionBuilder.fromXDR(built.xdr, built.networkPassphrase);
    tx.sign(merchant);
    await post('/api/tx/submit', { signedXdr: tx.toXDR(), action: 'list', refId: built.refId });
    console.log(`listed ${slug} #${copy.serial} @ ${price} USDC (open)`);
  }
  console.log('\n✅ demo cards minted + listings seeded');
}

main().catch((err) => {
  console.error('demo failed:', err.message);
  process.exit(1);
});

/**
 * Seed cards (task 4.3).
 *
 * Combines off-chain metadata (shared fixtures) with on-chain facts written by
 * the setup/deploy scripts:
 *   - stellar-accounts.json -> issuer per card asset
 *   - deploy.json           -> SAC address per card asset
 * Falls back to env PLATFORM_ISSUER if the artifacts are absent, so the catalog
 * still renders before a full testnet bootstrap.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { assetCodeForSlug, CARD_FIXTURES } from '@cardmkt/shared';
import { db, queryClient } from './client.js';
import { cards } from './schema.js';

const ROOT = resolve(process.cwd(), '../..');
config({ path: resolve(ROOT, '.env') });

function readJson<T>(file: string): T | null {
  const path = resolve(ROOT, file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

async function main() {
  const accounts = readJson<{
    cards: { slug: string; assetCode: string; issuer: string }[];
    creator?: { publicKey: string };
  }>('stellar-accounts.json');
  const deploy = readJson<{ cardSacs: Record<string, string> }>('deploy.json');
  const fallbackIssuer = process.env.PLATFORM_ISSUER ?? 'UNSET';

  const issuerFor = (slug: string) =>
    accounts?.cards.find((c) => c.slug === slug)?.issuer ?? fallbackIssuer;

  // A single demo creator account receives every card's royalty.
  const creatorAccount = accounts?.creator?.publicKey ?? process.env.CREATOR_ACCOUNT ?? null;

  const rows = CARD_FIXTURES.map((f) => {
    const assetCode = assetCodeForSlug(f.slug);
    return {
      assetCode,
      issuer: issuerFor(f.slug),
      sacAddress: deploy?.cardSacs?.[assetCode] ?? null,
      name: f.name,
      set: f.set,
      rarity: f.rarity,
      imageUrl: f.imageUrl,
      supply: f.supply,
      // A royalty rate is only meaningful with a creator account to pay.
      creatorAccount: f.royaltyBps > 0 ? creatorAccount : null,
      royaltyBps: f.royaltyBps,
    };
  });

  console.log(`[seed] upserting ${rows.length} cards...`);
  // Simple reset-and-insert; demo data, no FK dependents yet at seed time.
  await db.delete(cards);
  await db.insert(cards).values(rows);

  console.log('[seed] done.');
  await queryClient.end();
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await queryClient.end();
  process.exit(1);
});

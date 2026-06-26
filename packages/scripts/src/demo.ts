/**
 * Seed open demo listings (task 7.4).
 *
 * Lists a few cards from the merchant so the marketplace shows open listings on
 * first load. Run after setup/deploy/seed with the API up.
 *
 * Run: `pnpm --filter @cardmkt/scripts run demo`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const API = process.env.API_URL ?? 'http://localhost:4000';
const ROOT = resolve(process.cwd(), '../..');
const accounts = JSON.parse(readFileSync(resolve(ROOT, 'stellar-accounts.json'), 'utf8'));
const merchant = Keypair.fromSecret(accounts.merchant.secret);

const LISTINGS = [
  { code: 'STORM', price: '75' },
  { code: 'VOID', price: '120' },
  { code: 'GROVE', price: '15' },
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

async function main() {
  const cards = (await (await fetch(`${API}/api/cards`)).json()) as any[];
  for (const { code, price } of LISTINGS) {
    const card = cards.find((c: any) => c.assetCode === code);
    if (!card) continue;
    const built = await post('/api/tx/list', {
      cardId: card.id,
      seller: merchant.publicKey(),
      priceUsdc: price,
    });
    const tx = TransactionBuilder.fromXDR(built.xdr, built.networkPassphrase);
    tx.sign(merchant);
    await post('/api/tx/submit', { signedXdr: tx.toXDR(), action: 'list', refId: built.refId });
    console.log(`listed ${code} @ ${price} USDC (open)`);
  }
  console.log('\n✅ demo listings seeded');
}

main().catch((err) => {
  console.error('demo failed:', err.message);
  process.exit(1);
});

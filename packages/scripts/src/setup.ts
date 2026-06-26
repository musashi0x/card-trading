/**
 * Testnet bootstrap (tasks 2.2–2.4).
 *
 * Idempotent-ish setup that:
 *   1. creates + friendbot-funds a platform issuer, a demo merchant, a demo consumer
 *   2. issues a test USDC-equivalent asset and distributes it to the consumer
 *   3. issues the sample card assets and distributes copies to the merchant
 *
 * Writes the resulting addresses/secrets to `stellar-accounts.json` at the repo
 * root and prints the env lines to paste into `.env`.
 *
 * Run: `pnpm stellar:setup`
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { TESTNET, assetCodeForSlug, CARD_FIXTURES } from '@cardmkt/shared';

const HORIZON = process.env.STELLAR_HORIZON_URL ?? TESTNET.horizonUrl;
const PASSPHRASE = TESTNET.networkPassphrase;
const USDC_CODE = process.env.USDC_ASSET_CODE ?? 'USDC';

const server = new Horizon.Server(HORIZON);

async function friendbot(pubkey: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(pubkey)}`);
  if (!res.ok && res.status !== 400) {
    // 400 = account already exists; treat as fine.
    throw new Error(`friendbot failed for ${pubkey}: ${res.status}`);
  }
}

async function submit(source: Keypair, build: (b: TransactionBuilder) => void): Promise<string> {
  const account = await server.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  });
  build(builder);
  const tx = builder.setTimeout(60).build();
  tx.sign(source);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

async function trustAndReceive(
  holder: Keypair,
  issuer: Keypair,
  asset: Asset,
  amount: string,
): Promise<void> {
  // Holder establishes a trustline.
  await submit(holder, (b) => b.addOperation(Operation.changeTrust({ asset })));
  // Issuer mints by paying the holder.
  await submit(issuer, (b) =>
    b.addOperation(Operation.payment({ destination: holder.publicKey(), asset, amount })),
  );
}

async function main() {
  console.log(`[setup] network=testnet horizon=${HORIZON}`);

  const platform = Keypair.random();
  const merchant = Keypair.random();
  const consumer = Keypair.random();

  console.log('[setup] funding accounts via friendbot...');
  await Promise.all([
    friendbot(platform.publicKey()),
    friendbot(merchant.publicKey()),
    friendbot(consumer.publicKey()),
  ]);

  const usdc = new Asset(USDC_CODE, platform.publicKey());

  console.log('[setup] distributing test USDC...');
  await trustAndReceive(consumer, platform, usdc, '10000');
  await trustAndReceive(merchant, platform, usdc, '1000');

  console.log('[setup] issuing sample cards to the merchant...');
  const cards: { slug: string; assetCode: string; issuer: string }[] = [];
  for (const fixture of CARD_FIXTURES) {
    const assetCode = assetCodeForSlug(fixture.slug);
    const asset = new Asset(assetCode, platform.publicKey());
    // Give the merchant a few copies to list.
    const copies = Math.min(fixture.supply, 3).toString();
    await trustAndReceive(merchant, platform, asset, copies);
    cards.push({ slug: fixture.slug, assetCode, issuer: platform.publicKey() });
    console.log(`  • ${assetCode} (${fixture.name}) x${copies} -> merchant`);
  }

  const out = {
    network: 'testnet',
    platform: { publicKey: platform.publicKey(), secret: platform.secret() },
    merchant: { publicKey: merchant.publicKey(), secret: merchant.secret() },
    consumer: { publicKey: consumer.publicKey(), secret: consumer.secret() },
    usdc: { code: USDC_CODE, issuer: platform.publicKey() },
    cards,
  };
  // Write to the repo root so deploy/seed (run from other packages) find it.
  const outPath = resolve(process.cwd(), '../..', 'stellar-accounts.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log('\n[setup] done. Wrote stellar-accounts.json');
  console.log('\nPaste into your .env:\n');
  console.log(`PLATFORM_ISSUER=${platform.publicKey()}`);
  console.log(`PLATFORM_ISSUER_SECRET=${platform.secret()}`);
  console.log(`USDC_ASSET_CODE=${USDC_CODE}`);
  console.log(`USDC_ISSUER=${platform.publicKey()}`);
  console.log('\nDemo wallets (import secrets into Freighter):');
  console.log(`  merchant: ${merchant.publicKey()}`);
  console.log(`  consumer: ${consumer.publicKey()}`);
}

main().catch((err) => {
  console.error('[setup] failed:', err);
  process.exit(1);
});

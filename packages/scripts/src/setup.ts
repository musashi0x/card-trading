/**
 * Testnet bootstrap (tasks 2.2–2.4).
 *
 * Idempotent-ish setup that:
 *   1. creates + friendbot-funds a platform issuer, a demo merchant, a demo consumer
 *   2. issues a test USDC-equivalent asset and distributes it to the consumer
 *   3. (cards are NFTs now — minted via the API after deploy, not issued here)
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
import { TESTNET } from '@cardmkt/shared';

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
  // Issuer mints by paying the holder. Amount "0" means trustline-only (e.g. a
  // royalty payee that just needs to be able to receive the asset).
  if (Number(amount) > 0) {
    await submit(issuer, (b) =>
      b.addOperation(Operation.payment({ destination: holder.publicKey(), asset, amount })),
    );
  }
}

async function main() {
  console.log(`[setup] network=testnet horizon=${HORIZON}`);

  const platform = Keypair.random();
  // The dispute arbiter resolves physical-escrow disputes. A separate key from
  // the platform/admin so refereeing is decoupled from contract administration.
  const arbiter = Keypair.random();
  const merchant = Keypair.random();
  const consumer = Keypair.random();
  // The creator receives royalties on resale; it must trust USDC so atomic
  // settlement can deliver its cut.
  const creator = Keypair.random();
  // Provides XLM↔USDC liquidity on the DEX so a pay-with-any-asset path payment
  // always has a route on testnet.
  const marketMaker = Keypair.random();
  // A buyer that holds only XLM (no USDC), to demo pay-with-any-asset checkout.
  const xlmBuyer = Keypair.random();

  console.log('[setup] funding accounts via friendbot...');
  await Promise.all([
    friendbot(platform.publicKey()),
    friendbot(arbiter.publicKey()),
    friendbot(merchant.publicKey()),
    friendbot(consumer.publicKey()),
    friendbot(creator.publicKey()),
    friendbot(marketMaker.publicKey()),
    friendbot(xlmBuyer.publicKey()),
  ]);

  const usdc = new Asset(USDC_CODE, platform.publicKey());

  console.log('[setup] distributing test USDC...');
  await trustAndReceive(consumer, platform, usdc, '10000');
  await trustAndReceive(merchant, platform, usdc, '1000');
  // Creator only needs the trustline (0 balance) to be able to receive royalties.
  await trustAndReceive(creator, platform, usdc, '0');
  // Market maker holds USDC to sell into the XLM/USDC book.
  await trustAndReceive(marketMaker, platform, usdc, '20000');
  // The XLM-only buyer just needs a USDC trustline (0 balance) so a path payment
  // can deliver converted USDC into it.
  await trustAndReceive(xlmBuyer, platform, usdc, '0');

  console.log('[setup] seeding XLM↔USDC liquidity (sell USDC for XLM)...');
  // A sell offer of USDC for XLM gives strict-receive path finding a route from
  // XLM to USDC. Price is XLM per 1 USDC.
  await submit(marketMaker, (b) =>
    b.addOperation(
      Operation.manageSellOffer({
        selling: usdc,
        buying: Asset.native(),
        amount: '15000',
        price: '2',
      }),
    ),
  );

  // Cards are NFTs in the collection contract now — they are minted through
  // the API (`demo.ts` / `POST /api/cards/mint`) after deploy, not issued here.

  const out = {
    network: 'testnet',
    platform: { publicKey: platform.publicKey(), secret: platform.secret() },
    arbiter: { publicKey: arbiter.publicKey(), secret: arbiter.secret() },
    merchant: { publicKey: merchant.publicKey(), secret: merchant.secret() },
    consumer: { publicKey: consumer.publicKey(), secret: consumer.secret() },
    creator: { publicKey: creator.publicKey(), secret: creator.secret() },
    marketMaker: { publicKey: marketMaker.publicKey(), secret: marketMaker.secret() },
    xlmBuyer: { publicKey: xlmBuyer.publicKey(), secret: xlmBuyer.secret() },
    usdc: { code: USDC_CODE, issuer: platform.publicKey() },
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
  console.log(`ARBITER_SECRET=${arbiter.secret()}`);
  console.log('\nDemo wallets (import secrets into Freighter):');
  console.log(`  merchant: ${merchant.publicKey()}`);
  console.log(`  consumer: ${consumer.publicKey()}`);
  console.log(`  creator:  ${creator.publicKey()} (royalty payee)`);
}

main().catch((err) => {
  console.error('[setup] failed:', err);
  process.exit(1);
});

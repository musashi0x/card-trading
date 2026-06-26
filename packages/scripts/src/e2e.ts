/**
 * Headless end-to-end verification against the live API + testnet (tasks 7.1–7.3).
 *
 * Signs with the demo merchant/consumer secret keys (from stellar-accounts.json)
 * to drive the same build -> sign -> submit flow the browser wallet would:
 *   A. offer -> accept (hero flow)
 *   B. buy-now
 *   C. make-offer -> withdraw (consumer protection)
 *
 * Run: API must be up. `pnpm --filter @cardmkt/scripts run e2e`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Horizon, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const API = process.env.API_URL ?? 'http://localhost:4000';
const ROOT = resolve(process.cwd(), '../..');
const accounts = JSON.parse(readFileSync(resolve(ROOT, 'stellar-accounts.json'), 'utf8'));
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');

const merchant = Keypair.fromSecret(accounts.merchant.secret);
const consumer = Keypair.fromSecret(accounts.consumer.secret);

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

function sign(xdr: string, passphrase: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, passphrase);
  tx.sign(kp);
  return tx.toXDR();
}

/** build -> sign -> submit a contract action. */
async function action(
  buildPath: string,
  body: Record<string, unknown>,
  signer: Keypair,
  submitAction: string,
): Promise<{ refId: string; hash: string }> {
  const built = await post(buildPath, body);
  const signed = sign(built.xdr, built.networkPassphrase, signer);
  const submit = await post('/api/tx/submit', { signedXdr: signed, action: submitAction, refId: built.refId });
  return { refId: built.refId, hash: submit.hash };
}

async function trustline(cardId: string, signer: Keypair): Promise<void> {
  const built = await post('/api/tx/trustline', { account: signer.publicKey(), cardId });
  const signed = sign(built.xdr, built.networkPassphrase, signer);
  await post('/api/tx/submit-classic', { signedXdr: signed });
}

async function usdcBalance(account: string): Promise<number> {
  const acct = await horizon.loadAccount(account);
  const b = acct.balances.find(
    (x: any) => x.asset_code === accounts.usdc.code && x.asset_issuer === accounts.usdc.issuer,
  );
  return b ? Number(b.balance) : 0;
}

async function cardBalance(account: string, assetCode: string): Promise<number> {
  const acct = await horizon.loadAccount(account);
  const b = acct.balances.find((x: any) => x.asset_code === assetCode);
  return b ? Number(b.balance) : 0;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function cardByCode(code: string): Promise<string> {
  const cards = await get('/api/cards');
  const card = cards.find((c: any) => c.assetCode === code);
  if (!card) throw new Error(`card ${code} not found`);
  return card.id;
}

async function main() {
  console.log('=== A. offer -> accept (hero flow) ===');
  {
    const cardId = await cardByCode('NOVA');
    const sellerUsdc0 = await usdcBalance(merchant.publicKey());

    const { refId: listingId } = await action(
      '/api/tx/list',
      { cardId, seller: merchant.publicKey(), priceUsdc: '50' },
      merchant,
      'list',
    );
    console.log('  listed NOVA @ 50');

    await trustline(cardId, consumer);
    console.log('  consumer trustline -> NOVA');

    const { refId: offerId } = await action(
      '/api/tx/make-offer',
      { listingId, buyer: consumer.publicKey(), amountUsdc: '40' },
      consumer,
      'make_offer',
    );
    console.log('  consumer offered 40 (USDC escrowed)');

    await action('/api/tx/accept-offer', { offerId, seller: merchant.publicKey() }, merchant, 'accept_offer');
    console.log('  merchant accepted -> atomic settle');

    assert((await cardBalance(consumer.publicKey(), 'NOVA')) >= 1, 'consumer received NOVA');
    const sellerUsdc1 = await usdcBalance(merchant.publicKey());
    const received = sellerUsdc1 - sellerUsdc0;
    assert(Math.abs(received - 39.2) < 0.001, `seller received 39.2 USDC (40 - 2% fee), got ${received}`);
    const trades = await get('/api/trades');
    assert(trades.length >= 1, 'trade recorded with settlement hash');
  }

  console.log('=== B. buy-now ===');
  {
    const cardId = await cardByCode('EMBER');
    const { refId: listingId } = await action(
      '/api/tx/list',
      { cardId, seller: merchant.publicKey(), priceUsdc: '30' },
      merchant,
      'list',
    );
    await trustline(cardId, consumer);
    await action('/api/tx/buy-now', { listingId, buyer: consumer.publicKey() }, consumer, 'buy_now');
    assert((await cardBalance(consumer.publicKey(), 'EMBER')) >= 1, 'consumer bought EMBER via buy-now');
  }

  console.log('=== C. make-offer -> withdraw (consumer protection) ===');
  {
    const cardId = await cardByCode('TIDE');
    const { refId: listingId } = await action(
      '/api/tx/list',
      { cardId, seller: merchant.publicKey(), priceUsdc: '25' },
      merchant,
      'list',
    );
    await trustline(cardId, consumer);
    const before = await usdcBalance(consumer.publicKey());
    const { refId: offerId } = await action(
      '/api/tx/make-offer',
      { listingId, buyer: consumer.publicKey(), amountUsdc: '20' },
      consumer,
      'make_offer',
    );
    const during = await usdcBalance(consumer.publicKey());
    assert(Math.abs(before - during - 20) < 0.001, 'USDC locked in escrow on offer');
    await action('/api/tx/withdraw-offer', { offerId, buyer: consumer.publicKey() }, consumer, 'withdraw_offer');
    const after = await usdcBalance(consumer.publicKey());
    assert(Math.abs(after - before) < 0.001, 'USDC fully refunded on withdraw');
  }

  console.log('\n✅ ALL E2E SCENARIOS PASSED');
}

main().catch((err) => {
  console.error('\n❌ E2E FAILED:', err.message);
  process.exit(1);
});

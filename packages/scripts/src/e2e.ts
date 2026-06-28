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
const creator = Keypair.fromSecret(accounts.creator.secret);
const xlmBuyer = Keypair.fromSecret(accounts.xlmBuyer.secret);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Build endpoints simulate against Soroban RPC, whose state can lag a just-
 * settled tx (read-after-write). A freshly created listing/offer can momentarily
 * read as NotFound (contract error #3); retry a few times before giving up.
 */
async function postWithRetry(path: string, body: unknown, tries = 6): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      return await post(path, body);
    } catch (err) {
      const msg = String(err);
      const transient = msg.includes('Error(Contract, #3)') || msg.includes('NOT_CONFIRMED');
      if (!transient || i === tries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
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
  // Rebuild + resubmit on transient RPC lag (NotFound #3 / sequence / submit
  // races) — testnet RPC state can trail a just-settled tx by a few seconds.
  let lastErr: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      const built = await postWithRetry(buildPath, body);
      const signed = sign(built.xdr, built.networkPassphrase, signer);
      const submit = await post('/api/tx/submit', {
        signedXdr: signed,
        action: submitAction,
        refId: built.refId,
      });
      return { refId: built.refId, hash: submit.hash };
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      const transient =
        msg.includes('SUBMIT_FAILED') ||
        msg.includes('TX_EXPIRED') ||
        msg.includes('TX_BAD_SEQUENCE') ||
        msg.includes('TxBadSeq') ||
        msg.includes('Error(Contract, #3)') ||
        msg.includes('TX_FAILED');
      if (!transient || i === 5) throw err;
      await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
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

async function nativeBalance(account: string): Promise<number> {
  const acct = await horizon.loadAccount(account);
  const b = acct.balances.find((x: any) => x.asset_type === 'native');
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
  const creatorPk = accounts.creator.publicKey as string;

  console.log('=== A. offer -> accept (hero flow, 3-way split w/ 5% royalty) ===');
  {
    const cardId = await cardByCode('NOVA');
    const sellerUsdc0 = await usdcBalance(merchant.publicKey());
    const creatorUsdc0 = await usdcBalance(creatorPk);

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
    // 40 USDC: 2% fee (0.8) + 5% royalty (2.0) -> seller nets 37.2, creator +2.0.
    const received = (await usdcBalance(merchant.publicKey())) - sellerUsdc0;
    assert(Math.abs(received - 37.2) < 0.001, `seller received 37.2 (40 - 2% fee - 5% royalty), got ${received}`);
    const creatorGain = (await usdcBalance(creatorPk)) - creatorUsdc0;
    assert(Math.abs(creatorGain - 2.0) < 0.001, `creator received 2.0 royalty, got ${creatorGain}`);
    const trades = await get('/api/trades');
    assert(trades.length >= 1, 'trade recorded with settlement hash');
    assert(Math.abs(Number(trades[0].royaltyUsdc) - 2.0) < 0.001, 'trade row records the 2.0 royalty');
  }

  console.log('=== B. buy-now (3-way split w/ 3% royalty) ===');
  {
    const cardId = await cardByCode('EMBER');
    const sellerUsdc0 = await usdcBalance(merchant.publicKey());
    const creatorUsdc0 = await usdcBalance(creatorPk);
    const { refId: listingId } = await action(
      '/api/tx/list',
      { cardId, seller: merchant.publicKey(), priceUsdc: '30' },
      merchant,
      'list',
    );
    await trustline(cardId, consumer);
    await action('/api/tx/buy-now', { listingId, buyer: consumer.publicKey() }, consumer, 'buy_now');
    assert((await cardBalance(consumer.publicKey(), 'EMBER')) >= 1, 'consumer bought EMBER via buy-now');
    // 30 USDC: 2% fee (0.6) + 3% royalty (0.9) -> seller nets 28.5, creator +0.9.
    const received = (await usdcBalance(merchant.publicKey())) - sellerUsdc0;
    assert(Math.abs(received - 28.5) < 0.001, `seller received 28.5 (30 - 2% fee - 3% royalty), got ${received}`);
    const creatorGain = (await usdcBalance(creatorPk)) - creatorUsdc0;
    assert(Math.abs(creatorGain - 0.9) < 0.001, `creator received 0.9 royalty, got ${creatorGain}`);
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

  console.log('=== D. primary sale (seller == creator -> no royalty, 2-way split) ===');
  {
    const cardId = await cardByCode('VOID');
    const creatorUsdc0 = await usdcBalance(creator.publicKey());
    const { refId: listingId } = await action(
      '/api/tx/list',
      { cardId, seller: creator.publicKey(), priceUsdc: '50' },
      creator,
      'list',
    );
    await trustline(cardId, consumer);
    await action('/api/tx/buy-now', { listingId, buyer: consumer.publicKey() }, consumer, 'buy_now');
    assert((await cardBalance(consumer.publicKey(), 'VOID')) >= 1, 'consumer bought VOID via buy-now');
    // VOID carries a 5% royalty, but the seller IS the creator -> only the 2%
    // platform fee applies: seller nets 49.0, no separate royalty payout.
    const received = (await usdcBalance(creator.publicKey())) - creatorUsdc0;
    assert(Math.abs(received - 49.0) < 0.001, `creator-seller received 49.0 (50 - 2% fee, no royalty), got ${received}`);
    const trades = await get('/api/trades');
    assert(Number(trades[0].royaltyUsdc) === 0, 'primary sale records zero royalty');
  }

  console.log('=== E. pay-with-any-asset (XLM buyer -> path payment -> buy-now) ===');
  {
    const cardId = await cardByCode('GROVE'); // no royalty -> clean two-way split
    const price = '20';
    const sellerUsdc0 = await usdcBalance(merchant.publicKey());
    const { refId: listingId } = await action(
      '/api/tx/list',
      { cardId, seller: merchant.publicKey(), priceUsdc: price },
      merchant,
      'list',
    );
    await trustline(cardId, xlmBuyer); // card trustline so settlement can deliver
    console.log('  listed GROVE @ 20; XLM buyer trustline -> GROVE');

    // 1) Quote XLM -> USDC for the full price (the buyer holds no USDC).
    const quote = await post('/api/tx/quote-path', {
      buyer: xlmBuyer.publicKey(),
      sourceAsset: { code: 'XLM', issuer: null },
      destUsdc: price,
    });
    assert(
      Math.abs(Number(quote.destUsdc) - Number(price)) < 0.0001,
      `quote converts the full ${price} USDC (buyer holds none)`,
    );
    assert(Number(quote.sendMax) >= Number(quote.sendAmount), 'sendMax includes slippage headroom');

    // 2) Convert: build the path payment, sign with the XLM buyer, submit.
    const xlm0 = await nativeBalance(xlmBuyer.publicKey());
    const built = await post('/api/tx/path-payment', {
      buyer: xlmBuyer.publicKey(),
      sourceAsset: { code: 'XLM', issuer: null },
      destUsdc: quote.destUsdc,
      sendMax: quote.sendMax,
      path: quote.path,
    });
    const signed = sign(built.xdr, built.networkPassphrase, xlmBuyer);
    await post('/api/tx/submit-classic', { signedXdr: signed });
    console.log('  converted XLM -> USDC via path payment');

    const spent = xlm0 - (await nativeBalance(xlmBuyer.publicKey()));
    assert(spent > 0, 'buyer spent XLM on the conversion');
    assert(
      spent <= Number(quote.sendMax) + 0.01,
      `XLM spent within sendMax (+fees): spent ${spent} <= ${quote.sendMax}`,
    );
    const buyerUsdc = await usdcBalance(xlmBuyer.publicKey());
    assert(Math.abs(buyerUsdc - Number(price)) < 0.0001, `buyer now holds exactly ${price} USDC`);

    // 3) Settle: buy-now, now that the buyer holds the converted USDC.
    await action('/api/tx/buy-now', { listingId, buyer: xlmBuyer.publicKey() }, xlmBuyer, 'buy_now');
    assert((await cardBalance(xlmBuyer.publicKey(), 'GROVE')) >= 1, 'XLM buyer received GROVE via buy-now');
    // GROVE has no royalty: 2% fee on 20 -> seller nets 19.6.
    const received = (await usdcBalance(merchant.publicKey())) - sellerUsdc0;
    assert(Math.abs(received - 19.6) < 0.001, `seller received 19.6 (20 - 2% fee), got ${received}`);
  }

  console.log('=== F. pay-with-any-asset skip (USDC-holding buyer needs no conversion) ===');
  {
    // The consumer already holds USDC, so the quote should size the conversion
    // to zero and the UI/flow skips the path payment entirely.
    const quote = await post('/api/tx/quote-path', {
      buyer: consumer.publicKey(),
      sourceAsset: { code: 'XLM', issuer: null },
      destUsdc: '20',
    });
    assert(Number(quote.destUsdc) === 0, 'USDC-holding buyer gets a zero-conversion quote');
    assert(
      quote.path.length === 0 && Number(quote.sendMax) === 0,
      'no path payment is needed when USDC already suffices',
    );
  }

  console.log('\n✅ ALL E2E SCENARIOS PASSED');
}

main().catch((err) => {
  console.error('\n❌ E2E FAILED:', err.message);
  process.exit(1);
});

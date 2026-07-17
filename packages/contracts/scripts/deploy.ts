/**
 * Deploy the card-collection (NFT) and marketplace contracts to testnet and
 * initialize the marketplace (task 3.8, updated for NFT card custody — task 8.1).
 *
 * Prereq: run `pnpm stellar:setup` first to create funded accounts + the USDC
 * asset (writes stellar-accounts.json at the repo root), and `pnpm contract:build`
 * to produce both wasms (`stellar contract build` — plain `cargo build
 * --target wasm32v1-none --release` fails the OZ crates' spec-shaking feature
 * check, so the stellar CLI path is required).
 *
 * This:
 *   1. deploys the Stellar Asset Contract (SAC) for USDC — the only remaining
 *      SEP-41 leg; cards are NFTs in the collection contract now, not SACs
 *   2. deploys the card-collection wasm, owned by the platform account (cards
 *      are minted later, server-side, via the API)
 *   3. deploys the marketplace wasm and calls
 *      `init(admin=platform, platform, arbiter, usdc_sac, fee_bps, max_royalty_bps, collection)`
 *   4. writes deploy.json with both contract ids + the USDC SAC address
 *
 * Run: `pnpm contract:deploy`
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd(), '../..');
const MARKETPLACE_WASM = resolve(
  process.cwd(),
  'target/wasm32v1-none/release/marketplace_contract.wasm',
);
const COLLECTION_WASM = resolve(
  process.cwd(),
  'target/wasm32v1-none/release/card_collection.wasm',
);
const NETWORK = 'testnet';
const FEE_BPS = '200'; // 2%
const MAX_ROYALTY_BPS = '1000'; // 10% ceiling; fee + royalty must stay < 100%
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
// Collection metadata. The base URI is a placeholder card-metadata host; token
// URIs are resolved as `${base_uri}${token_id}` by clients.
const COLLECTION_BASE_URI = 'https://topdeck.example/cards/';
const COLLECTION_NAME = 'TopDeck Cards';
const COLLECTION_SYMBOL = 'TOPDECK';

// CLI 27's `contract id asset --network testnet` reads the rpc-url from the named
// network but not its passphrase, so it errors unless the passphrase is in the
// environment. Inject it for every call so a half-configured network still works.
function sh(args: string[]): string {
  return execFileSync('stellar', args, {
    encoding: 'utf8',
    env: { ...process.env, STELLAR_NETWORK_PASSPHRASE: NETWORK_PASSPHRASE },
  }).trim();
}

// A `contract deploy` returns before the RPC has indexed the new instance, so an
// immediate invoke can fail with Error(Storage, MissingValue). Retry through the
// propagation gap before giving up.
function shRetry(args: string[], tries = 5, delayMs = 3000): string {
  for (let attempt = 1; ; attempt++) {
    try {
      return sh(args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= tries || !msg.includes('MissingValue')) throw err;
      console.log(`  (instance not indexed yet — retry ${attempt}/${tries - 1})`);
      execFileSync('sleep', [String(delayMs / 1000)]);
    }
  }
}

interface Accounts {
  platform: { publicKey: string; secret: string };
  arbiter?: { publicKey: string };
  usdc: { code: string; issuer: string };
}

function deploySac(asset: string, source: string): string {
  // Deploy is idempotent-ish: if already deployed, fetch the id instead.
  try {
    return sh(['contract', 'asset', 'deploy', '--asset', asset, '--source-account', source, '--network', NETWORK]);
  } catch {
    // `contract id asset` derives the SAC address deterministically; CLI 27 takes
    // only --asset (+ network), not --source-account.
    return sh(['contract', 'id', 'asset', '--asset', asset, '--network', NETWORK]);
  }
}

function main() {
  const accounts: Accounts = JSON.parse(readFileSync(resolve(ROOT, 'stellar-accounts.json'), 'utf8'));
  const source = accounts.platform.secret;

  console.log('[deploy] deploying USDC SAC...');
  const usdcAsset = `${accounts.usdc.code}:${accounts.usdc.issuer}`;
  const usdcSac = deploySac(usdcAsset, source);
  console.log(`  USDC SAC: ${usdcSac}`);

  console.log('[deploy] deploying card-collection (NFT) contract...');
  const collectionId = sh([
    'contract', 'deploy', '--wasm', COLLECTION_WASM, '--source-account', source, '--network', NETWORK,
    '--',
    '--owner', accounts.platform.publicKey,
    '--base_uri', COLLECTION_BASE_URI,
    '--name', COLLECTION_NAME,
    '--symbol', COLLECTION_SYMBOL,
  ]);
  console.log(`  COLLECTION_CONTRACT_ID: ${collectionId}`);

  console.log('[deploy] deploying marketplace contract...');
  const contractId = sh([
    'contract', 'deploy', '--wasm', MARKETPLACE_WASM, '--source-account', source, '--network', NETWORK,
  ]);
  console.log(`  CONTRACT_ID: ${contractId}`);

  console.log('[deploy] initializing contract...');
  // Dispute arbiter for physical-escrow orders; falls back to the platform admin
  // for account files created before arbitration (re-run setup for a separate key).
  const arbiter = accounts.arbiter?.publicKey ?? accounts.platform.publicKey;
  if (!accounts.arbiter) {
    console.warn('[deploy] no arbiter account in stellar-accounts.json — using platform as arbiter');
  }
  shRetry([
    'contract', 'invoke', '--id', contractId, '--source-account', source, '--network', NETWORK,
    '--', 'init',
    '--admin', accounts.platform.publicKey,
    '--platform', accounts.platform.publicKey,
    '--arbiter', arbiter,
    '--usdc_token', usdcSac,
    '--fee_bps', FEE_BPS,
    '--max_royalty_bps', MAX_ROYALTY_BPS,
    '--collection', collectionId,
  ]);

  const out = {
    network: NETWORK,
    contractId,
    collectionId,
    usdcSac,
    feeBps: Number(FEE_BPS),
    maxRoyaltyBps: Number(MAX_ROYALTY_BPS),
  };
  writeFileSync(resolve(ROOT, 'deploy.json'), JSON.stringify(out, null, 2));

  console.log('\n[deploy] done. Wrote deploy.json');
  console.log(`\nAdd to .env:\nCONTRACT_ID=${contractId}\nCOLLECTION_CONTRACT_ID=${collectionId}`);
}

main();

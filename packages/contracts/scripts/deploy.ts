/**
 * Deploy the marketplace contract to testnet and initialize it (task 3.8).
 *
 * Prereq: run `pnpm stellar:setup` first to create funded accounts + assets
 * (writes stellar-accounts.json at the repo root).
 *
 * This:
 *   1. deploys the Stellar Asset Contract (SAC) for USDC and each sample card
 *      so the marketplace can move them via the token interface
 *   2. deploys the marketplace wasm
 *   3. calls `init(admin=platform, platform, usdc_sac, fee_bps)`
 *   4. writes deploy.json with the contract id + SAC address map
 *
 * Run: `pnpm contract:deploy`
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd(), '../..');
const WASM = resolve(
  process.cwd(),
  'target/wasm32v1-none/release/marketplace_contract.wasm',
);
const NETWORK = 'testnet';
const FEE_BPS = '200'; // 2%

function sh(args: string[]): string {
  return execFileSync('stellar', args, { encoding: 'utf8' }).trim();
}

interface Accounts {
  platform: { publicKey: string; secret: string };
  usdc: { code: string; issuer: string };
  cards: { slug: string; assetCode: string; issuer: string }[];
}

function deploySac(asset: string, source: string): string {
  // Deploy is idempotent-ish: if already deployed, fetch the id instead.
  try {
    return sh(['contract', 'asset', 'deploy', '--asset', asset, '--source-account', source, '--network', NETWORK]);
  } catch {
    return sh(['contract', 'id', 'asset', '--asset', asset, '--source-account', source, '--network', NETWORK]);
  }
}

function main() {
  const accounts: Accounts = JSON.parse(readFileSync(resolve(ROOT, 'stellar-accounts.json'), 'utf8'));
  const source = accounts.platform.secret;

  console.log('[deploy] deploying USDC SAC...');
  const usdcAsset = `${accounts.usdc.code}:${accounts.usdc.issuer}`;
  const usdcSac = deploySac(usdcAsset, source);
  console.log(`  USDC SAC: ${usdcSac}`);

  console.log('[deploy] deploying card SACs...');
  const cardSacs: Record<string, string> = {};
  for (const card of accounts.cards) {
    const sac = deploySac(`${card.assetCode}:${card.issuer}`, source);
    cardSacs[card.assetCode] = sac;
    console.log(`  ${card.assetCode} SAC: ${sac}`);
  }

  console.log('[deploy] deploying marketplace contract...');
  const contractId = sh([
    'contract', 'deploy', '--wasm', WASM, '--source-account', source, '--network', NETWORK,
  ]);
  console.log(`  CONTRACT_ID: ${contractId}`);

  console.log('[deploy] initializing contract...');
  sh([
    'contract', 'invoke', '--id', contractId, '--source-account', source, '--network', NETWORK,
    '--', 'init',
    '--admin', accounts.platform.publicKey,
    '--platform', accounts.platform.publicKey,
    '--usdc_token', usdcSac,
    '--fee_bps', FEE_BPS,
  ]);

  const out = { network: NETWORK, contractId, usdcSac, cardSacs, feeBps: Number(FEE_BPS) };
  writeFileSync(resolve(ROOT, 'deploy.json'), JSON.stringify(out, null, 2));

  console.log('\n[deploy] done. Wrote deploy.json');
  console.log(`\nAdd to .env:\nCONTRACT_ID=${contractId}`);
}

main();

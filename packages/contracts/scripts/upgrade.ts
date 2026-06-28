/**
 * Upgrade the already-deployed marketplace contract in place — keeps the same
 * CONTRACT_ID and all stored state (listings, offers, orders, auctions,
 * royalties), only swapping the code. Use this after adding a new entrypoint
 * (e.g. `create_auction`) so the live contract gains it without a state-losing
 * redeploy.
 *
 * Prereq: the contract was originally deployed via `pnpm deploy` (so deploy.json
 * exists with `contractId`) and `stellar-accounts.json` holds the platform/admin
 * account whose key authorized `init` — only that admin may call `upgrade`.
 *
 * This:
 *   1. builds the wasm (`stellar contract build`)
 *   2. uploads it to the network -> wasm hash
 *   3. invokes `upgrade(new_wasm_hash)` signed by the admin
 *
 * Run: `pnpm contract:upgrade`
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd(), '../..');
const WASM = resolve(
  process.cwd(),
  'target/wasm32v1-none/release/marketplace_contract.wasm',
);
const NETWORK = 'testnet';

function sh(args: string[]): string {
  return execFileSync('stellar', args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }).trim();
}

interface Accounts {
  platform: { publicKey: string; secret: string };
}

interface Deploy {
  contractId: string;
}

function main() {
  const accounts: Accounts = JSON.parse(readFileSync(resolve(ROOT, 'stellar-accounts.json'), 'utf8'));
  const deploy: Deploy = JSON.parse(readFileSync(resolve(process.cwd(), 'deploy.json'), 'utf8'));
  const source = accounts.platform.secret;
  const { contractId } = deploy;

  console.log('[upgrade] building wasm...');
  sh(['contract', 'build']);

  console.log('[upgrade] uploading wasm...');
  const wasmHash = sh([
    'contract', 'upload', '--wasm', WASM, '--source-account', source, '--network', NETWORK,
  ]);
  console.log(`  wasm hash: ${wasmHash}`);

  console.log(`[upgrade] invoking upgrade on ${contractId}...`);
  sh([
    'contract', 'invoke', '--id', contractId, '--source-account', source, '--network', NETWORK,
    '--', 'upgrade',
    '--new_wasm_hash', wasmHash,
  ]);

  console.log('\n[upgrade] done. Contract id unchanged; new code is live.');
  console.log(`CONTRACT_ID=${contractId}`);
}

main();

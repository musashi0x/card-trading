import { explorerAccountUrl, explorerTxUrl } from '@cardmkt/shared';

const BASE = process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

export function explorerTx(hash: string): string {
  return explorerTxUrl(hash, BASE);
}

export function explorerAccount(address: string): string {
  return explorerAccountUrl(address, BASE);
}

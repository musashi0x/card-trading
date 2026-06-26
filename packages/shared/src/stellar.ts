/**
 * Stellar network configuration and SDK helpers.
 *
 * Centralizes network constants so api, web, and scripts never drift on
 * passphrase/RPC. USDC pricing uses 7 decimals (Stellar's stroop precision).
 */

export const STROOP_DECIMALS = 7;

export interface StellarConfig {
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
}

export const TESTNET: StellarConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

/** Resolve config from environment, defaulting to testnet. */
export function stellarConfigFromEnv(env: Record<string, string | undefined> = process.env): StellarConfig {
  return {
    network: (env.STELLAR_NETWORK as 'testnet' | 'mainnet') ?? TESTNET.network,
    rpcUrl: env.STELLAR_RPC_URL ?? TESTNET.rpcUrl,
    horizonUrl: env.STELLAR_HORIZON_URL ?? TESTNET.horizonUrl,
    networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE ?? TESTNET.networkPassphrase,
  };
}

/**
 * Convert a human decimal amount (e.g. "12.5") into a contract i128 string of
 * stroops. Avoids floating point by operating on the string directly.
 */
export function toStroops(amount: string): bigint {
  const [whole, fraction = ''] = amount.trim().split('.');
  const paddedFraction = (fraction + '0'.repeat(STROOP_DECIMALS)).slice(0, STROOP_DECIMALS);
  return BigInt(whole || '0') * 10n ** BigInt(STROOP_DECIMALS) + BigInt(paddedFraction || '0');
}

/** Convert stroops back into a human decimal string (trims trailing zeros). */
export function fromStroops(stroops: bigint | string): string {
  const value = BigInt(stroops);
  const base = 10n ** BigInt(STROOP_DECIMALS);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(STROOP_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Build an explorer URL for a transaction hash. */
export function explorerTxUrl(hash: string, base: string): string {
  return `${base.replace(/\/$/, '')}/tx/${hash}`;
}

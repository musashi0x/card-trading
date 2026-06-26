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

/**
 * Format a numeric amount as a Stellar-safe decimal string: never scientific
 * notation, at most STROOP_DECIMALS (7) fractional digits, trailing zeros
 * trimmed. Matches what `toStroops` and the API's `decimalAmount` schema accept,
 * so a raw UI value like `1e-9` or `5.123456789` (which `String(n)` would emit
 * verbatim) can't slip through as a 400-triggering request body.
 */
export function formatAmount(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n) || n <= 0) return '0';
  let s = n.toFixed(STROOP_DECIMALS);
  // toFixed still emits exponent form for magnitudes >= 1e21; such an amount has
  // no meaningful sub-unit precision, so fall back to its plain integer digits.
  if (s.includes('e') || s.includes('E')) s = BigInt(Math.round(n)).toString();
  const trimmed = s.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
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

/** Build an explorer URL for an account/contract address. */
export function explorerAccountUrl(address: string, base: string): string {
  return `${base.replace(/\/$/, '')}/account/${address}`;
}

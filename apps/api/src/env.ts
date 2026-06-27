/**
 * Validated server configuration. Fails fast at boot if required Stellar
 * wiring is missing, so requests never half-work against an unconfigured chain.
 */

import { resolve } from 'node:path';
import { config } from 'dotenv';
import { stellarConfigFromEnv } from '@cardmkt/shared';

// Load the monorepo-root .env regardless of the per-package cwd pnpm sets.
config({ path: resolve(process.cwd(), '../..', '.env') });
config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  /** Minimum log severity emitted by the shared logger. */
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /**
   * Per-IP rate limiting. Protects shared upstreams (Stellar RPC, the sponsoring
   * relay, Postgres) from a single client overwhelming the service. `windowMs`
   * is the sliding window; `max` is the request budget per window per client.
   */
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
  },
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cardmkt',
  stellar: stellarConfigFromEnv(),
  contractId: required('CONTRACT_ID'),
  usdc: {
    code: process.env.USDC_ASSET_CODE ?? 'USDC',
    issuer: required('USDC_ISSUER'),
  },
  platformIssuer: required('PLATFORM_ISSUER'),
  /**
   * Dispute arbiter secret. The arbiter is a separate key from the admin so
   * refereeing is decoupled from contract administration. The API signs `resolve`
   * server-side with this key (an arbitration-dashboard action). Empty when
   * arbitration is not configured; the resolve route then returns 501.
   */
  arbiterSecret: process.env.ARBITER_SECRET ?? '',
  /**
   * Secret for the USDC issuer (== platform issuer here), used only by the
   * testnet-gated dev funding route to mint test USDC to a smart wallet. Empty
   * in environments that don't enable dev funding.
   */
  usdcIssuerSecret: process.env.PLATFORM_ISSUER_SECRET ?? process.env.USDC_ISSUER_SECRET ?? '',
  feeBps: Number(process.env.FEE_BPS ?? 200),
  /** Default slippage tolerance (bps) baked into a pay-with-any-asset `sendMax`. */
  pathPaymentSlippageBps: Number(process.env.PATH_PAYMENT_SLIPPAGE_BPS ?? 50),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  /**
   * Passkey smart-wallet config. The relay (OpenZeppelin Channels by default,
   * Launchtube as the legacy fallback) sponsors fees so consumers need no XLM.
   * `relayProvider` selects the adapter; both are optional so the API still
   * boots for the classic-wallet flow when passkey checkout is not configured.
   */
  passkey: {
    /** 'channels' (default) or 'launchtube'. */
    relayProvider: process.env.PASSKEY_RELAY_PROVIDER ?? 'channels',
    /** OpenZeppelin Channels relayer base URL. */
    channelsUrl: process.env.CHANNELS_URL ?? 'https://channels.openzeppelin.com/testnet',
    /** OpenZeppelin Channels API key. */
    channelsApiKey: process.env.CHANNELS_API_KEY ?? '',
    /** Launchtube endpoint (legacy fallback relay). */
    launchtubeUrl: process.env.LAUNCHTUBE_URL ?? '',
    /** Launchtube JWT (legacy fallback relay). */
    launchtubeJwt: process.env.LAUNCHTUBE_JWT ?? '',
    /** Deployed smart-wallet WASM hash (passkey-kit factory). */
    walletWasmHash: process.env.PASSKEY_WALLET_WASM_HASH ?? '',
    /** WebAuthn Relying Party id (e.g. the demo host). */
    rpId: process.env.PASSKEY_RP_ID ?? 'localhost',
  },
};

export type Env = typeof env;

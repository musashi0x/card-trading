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
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cardmkt',
  stellar: stellarConfigFromEnv(),
  contractId: required('CONTRACT_ID'),
  usdc: {
    code: process.env.USDC_ASSET_CODE ?? 'USDC',
    issuer: required('USDC_ISSUER'),
  },
  platformIssuer: required('PLATFORM_ISSUER'),
  feeBps: Number(process.env.FEE_BPS ?? 200),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
};

export type Env = typeof env;

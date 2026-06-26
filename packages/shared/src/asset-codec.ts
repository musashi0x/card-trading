/**
 * Card <-> Stellar asset codec.
 *
 * A card is a classic Stellar asset issued by the platform issuer. The asset
 * code is the on-chain handle; this module is the single place that maps
 * between a card's asset code and a Stellar `Asset` so api and web never drift.
 */

import { Asset } from '@stellar/stellar-sdk';

/** Stellar asset codes are 1-12 alphanumeric characters. */
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

export function isValidAssetCode(code: string): boolean {
  return ASSET_CODE_RE.test(code);
}

/**
 * Derive a deterministic, valid Stellar asset code from a card's short slug.
 * Uppercases, strips non-alphanumerics, and truncates to 12 chars.
 */
export function assetCodeForSlug(slug: string): string {
  const code = slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!code) throw new Error(`Cannot derive asset code from slug: "${slug}"`);
  return code;
}

/** Build the Stellar `Asset` for a card. */
export function cardAsset(assetCode: string, issuer: string): Asset {
  if (!isValidAssetCode(assetCode)) {
    throw new Error(`Invalid asset code: "${assetCode}"`);
  }
  return new Asset(assetCode, issuer);
}

/** Build the Stellar `Asset` for the test payment currency (USDC-equivalent). */
export function usdcAsset(code: string, issuer: string): Asset {
  return new Asset(code, issuer);
}

/** A stable string key for an asset, used in DB rows and contract args. */
export function assetKey(code: string, issuer: string): string {
  return `${code}:${issuer}`;
}

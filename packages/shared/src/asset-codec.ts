/**
 * Card <-> Stellar asset codec.
 *
 * A card is a classic Stellar asset issued by the platform issuer. The asset
 * code is the on-chain handle; this module is the single place that maps
 * between a card's asset code and a Stellar `Asset` so api and web never drift.
 */

import { Asset } from '@stellar/stellar-sdk';

import type { StellarAsset } from './types';

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

/**
 * Generate a candidate asset code for a freshly minted card: up to 8 alphanumeric
 * chars from the card name, plus a short random suffix so two cards with the same
 * name don't collide on the same `code:issuer` asset. The caller should retry with
 * a fresh code if its uniqueness check (vs. existing cards) fails.
 */
export function mintAssetCode(name: string, rand: () => number = Math.random): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CARD';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(rand() * alphabet.length)];
  return `${base}${suffix}`.slice(0, 12);
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

/** The native asset (XLM) as a {@link StellarAsset} — `issuer` is `null`. */
export const XLM_ASSET: StellarAsset = { code: 'XLM', issuer: null };

/** True when a {@link StellarAsset} refers to the native asset (XLM). */
export function isNativeAsset(asset: StellarAsset): boolean {
  return asset.issuer === null;
}

/** Convert a {@link StellarAsset} into a Stellar SDK `Asset` (native when issuerless). */
export function toStellarAsset(asset: StellarAsset): Asset {
  return isNativeAsset(asset) ? Asset.native() : new Asset(asset.code, asset.issuer as string);
}

/** Convert a Stellar SDK `Asset` into a {@link StellarAsset} wire shape. */
export function fromStellarAsset(asset: Asset): StellarAsset {
  return asset.isNative() ? { ...XLM_ASSET } : { code: asset.getCode(), issuer: asset.getIssuer() };
}

/** A stable string key for an asset, used in DB rows and contract args. */
export function assetKey(code: string, issuer: string): string {
  return `${code}:${issuer}`;
}

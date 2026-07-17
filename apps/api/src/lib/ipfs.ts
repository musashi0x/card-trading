/**
 * IPFS pinning for card art. One small client interface with two wire
 * implementations — a self-hosted Kubo node (local dev, docker-compose) and
 * Pinata (production) — selected by env config. Both return CIDv1 so the
 * stored `ipfs://` URI is identical for identical bytes regardless of
 * provider. With neither configured `ipfsClientFromEnv` returns null and the
 * mint flow stores the uploaded data URL verbatim (legacy behavior).
 */

import { env } from '../env.js';
import { logger } from '../logger.js';

export interface IpfsClient {
  /** Pin raw bytes; resolves to the CIDv1 string (no `ipfs://` prefix). */
  pin(bytes: Uint8Array, mimeType: string): Promise<string>;
  /** Remove a pin. Callers treat failures as best-effort (log, don't rethrow). */
  unpin(cid: string): Promise<void>;
}

/** `data:image/jpeg;base64,...` → bytes + mime. Throws on anything malformed. */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('Malformed data: URL');
  const bytes = Uint8Array.from(Buffer.from(match[2]!, 'base64'));
  if (bytes.length === 0) throw new Error('Empty data: URL payload');
  return { bytes, mimeType: match[1]! };
}

function extensionFor(mimeType: string): string {
  return mimeType.split('/')[1]?.split('+')[0] ?? 'bin';
}

/** Talks to a Kubo node's RPC (docker-compose `kubo` service in dev). */
export class KuboClient implements IpfsClient {
  constructor(private readonly apiUrl: string) {}

  async pin(bytes: Uint8Array, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeType }), `card.${extensionFor(mimeType)}`);
    const res = await fetch(`${this.apiUrl}/api/v0/add?pin=true&cid-version=1`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error(`Kubo add failed: ${res.status} ${await res.text()}`);
    const { Hash } = (await res.json()) as { Hash?: string };
    if (!Hash) throw new Error('Kubo add returned no CID');
    return Hash;
  }

  async unpin(cid: string): Promise<void> {
    const res = await fetch(`${this.apiUrl}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`Kubo pin/rm failed: ${res.status} ${await res.text()}`);
  }
}

/** Talks to Pinata's v3 Files API (upload host + api host) with a JWT. */
export class PinataClient implements IpfsClient {
  constructor(
    private readonly jwt: string,
    private readonly uploadUrl = 'https://uploads.pinata.cloud',
    private readonly apiUrl = 'https://api.pinata.cloud',
  ) {}

  private get headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.jwt}` };
  }

  async pin(bytes: Uint8Array, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeType }), `card.${extensionFor(mimeType)}`);
    form.append('network', 'public');
    const res = await fetch(`${this.uploadUrl}/v3/files`, {
      method: 'POST',
      headers: this.headers,
      body: form,
    });
    if (!res.ok) throw new Error(`Pinata upload failed: ${res.status} ${await res.text()}`);
    const { data } = (await res.json()) as { data?: { cid?: string } };
    if (!data?.cid) throw new Error('Pinata upload returned no CID');
    return data.cid;
  }

  async unpin(cid: string): Promise<void> {
    // Pinata deletes by file id, not CID — look the id up first.
    const list = await fetch(`${this.apiUrl}/v3/files/public?cid=${encodeURIComponent(cid)}`, {
      headers: this.headers,
    });
    if (!list.ok) throw new Error(`Pinata file lookup failed: ${list.status} ${await list.text()}`);
    const { data } = (await list.json()) as { data?: { files?: { id: string }[] } };
    const fileId = data?.files?.[0]?.id;
    if (!fileId) return; // already gone — unpin is idempotent
    const res = await fetch(`${this.apiUrl}/v3/files/public/${fileId}`, {
      method: 'DELETE',
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Pinata delete failed: ${res.status} ${await res.text()}`);
  }
}

/** Kubo wins when both are configured (explicit node beats hosted service). */
export function ipfsClientFrom(config: { apiUrl: string; pinataJwt: string }): IpfsClient | null {
  if (config.apiUrl) return new KuboClient(config.apiUrl.replace(/\/$/, ''));
  if (config.pinataJwt) return new PinataClient(config.pinataJwt);
  return null;
}

export const ipfsClient: IpfsClient | null = ipfsClientFrom(env.ipfs);

/**
 * `ipfs://<CID>` → fetchable gateway URL; every other scheme (https:, data:)
 * passes through untouched, so legacy rows keep working.
 */
export function resolveImageUrl(url: string, gatewayUrl = env.ipfs.gatewayUrl): string {
  const cid = url.startsWith('ipfs://') ? url.slice('ipfs://'.length) : null;
  return cid ? `${gatewayUrl}/ipfs/${cid}` : url;
}

/**
 * The one sanctioned way to swap a card's image: pin the replacement first,
 * persist the new URL, then unpin the old CID best-effort (a failed unpin
 * leaks a pin — logged, never fatal — while the card row is already correct).
 * Non-`data:` replacements and unconfigured environments pass the new value
 * through unchanged, mirroring the mint path.
 */
export async function replacePinnedImage(
  oldUrl: string,
  newImage: string,
  persist: (newUrl: string) => Promise<void>,
  client: IpfsClient | null = ipfsClient,
): Promise<string> {
  let newUrl = newImage;
  if (client && newImage.startsWith('data:')) {
    const { bytes, mimeType } = dataUrlToBytes(newImage);
    newUrl = `ipfs://${await client.pin(bytes, mimeType)}`;
  }
  await persist(newUrl);
  const oldCid = oldUrl.startsWith('ipfs://') ? oldUrl.slice('ipfs://'.length) : null;
  if (client && oldCid && newUrl !== oldUrl) {
    try {
      await client.unpin(oldCid);
    } catch (err) {
      logger.warn({ err, cid: oldCid }, 'failed to unpin replaced card image');
    }
  }
  return newUrl;
}

/**
 * Walk a JSON-shaped payload and resolve every `imageUrl` field in place.
 * Card rows surface under many routes (catalog, portfolio, orders, auctions,
 * watchlist, trade proposals, leaderboard, mint) — rewriting at the response
 * boundary keeps the raw `ipfs://` URI as the single stored form in Postgres
 * while every client receives a directly fetchable URL.
 */
export function rewriteImageUrls(value: unknown, gatewayUrl = env.ipfs.gatewayUrl): void {
  if (Array.isArray(value)) {
    for (const item of value) rewriteImageUrls(item, gatewayUrl);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(obj)) {
    if (key === 'imageUrl' && typeof child === 'string') {
      obj[key] = resolveImageUrl(child, gatewayUrl);
    } else {
      rewriteImageUrls(child, gatewayUrl);
    }
  }
}

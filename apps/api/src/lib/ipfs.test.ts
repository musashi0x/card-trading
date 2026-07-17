/**
 * Tests for the IPFS pinning client: provider selection, data URL decoding,
 * pin/unpin request shapes against a mocked `fetch`, and gateway resolution.
 * No network is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  env: { ipfs: { apiUrl: '', pinataJwt: '', gatewayUrl: 'https://gw.example.com' } },
}));

vi.mock('../logger.js', () => ({
  env: {},
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  KuboClient,
  PinataClient,
  dataUrlToBytes,
  ipfsClientFrom,
  replacePinnedImage,
  resolveImageUrl,
  rewriteImageUrls,
} from './ipfs.js';

// A 1-byte payload ("h") — enough to exercise the wire shape.
const DATA_URL = 'data:image/jpeg;base64,aA==';
const CID = 'bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('dataUrlToBytes', () => {
  it('decodes a base64 data URL into bytes + mime type', () => {
    const { bytes, mimeType } = dataUrlToBytes(DATA_URL);
    expect(mimeType).toBe('image/jpeg');
    expect(Array.from(bytes)).toEqual([0x68]);
  });

  it.each([
    ['not a data url', 'https://example.com/x.png'],
    ['missing base64 marker', 'data:image/png,rawpixels'],
    ['invalid base64 alphabet', 'data:image/png;base64,!!!!'],
    ['empty payload', 'data:image/png;base64,'],
  ])('rejects %s', (_label, input) => {
    expect(() => dataUrlToBytes(input)).toThrow();
  });
});

describe('ipfsClientFrom', () => {
  it('returns null when nothing is configured', () => {
    expect(ipfsClientFrom({ apiUrl: '', pinataJwt: '' })).toBeNull();
  });

  it('selects Kubo when an API URL is set, even alongside a Pinata JWT', () => {
    expect(ipfsClientFrom({ apiUrl: 'http://localhost:5001', pinataJwt: 'jwt' })).toBeInstanceOf(
      KuboClient,
    );
  });

  it('selects Pinata when only a JWT is set', () => {
    expect(ipfsClientFrom({ apiUrl: '', pinataJwt: 'jwt' })).toBeInstanceOf(PinataClient);
  });
});

describe('KuboClient', () => {
  const client = new KuboClient('http://kubo:5001');

  it('pins via /api/v0/add with pin + CIDv1 flags and returns the CID', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Hash: CID }));
    const cid = await client.pin(new Uint8Array([1]), 'image/jpeg');
    expect(cid).toBe(CID);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://kubo:5001/api/v0/add?pin=true&cid-version=1');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('throws when the node errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(client.pin(new Uint8Array([1]), 'image/jpeg')).rejects.toThrow(/Kubo add failed/);
  });

  it('unpins via /api/v0/pin/rm', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await client.unpin(CID);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://kubo:5001/api/v0/pin/rm?arg=${CID}`);
    expect(init.method).toBe('POST');
  });
});

describe('PinataClient', () => {
  const client = new PinataClient('test-jwt');

  it('uploads to the v3 files endpoint with JWT auth and returns the CID', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { cid: CID } }));
    const cid = await client.pin(new Uint8Array([1]), 'image/png');
    expect(cid).toBe(CID);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://uploads.pinata.cloud/v3/files');
    expect(init.headers.Authorization).toBe('Bearer test-jwt');
    const form = init.body as FormData;
    expect(form.get('network')).toBe('public');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('unpins by looking up the file id for the CID, then deleting it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { files: [{ id: 'file-123' }] } }))
      .mockResolvedValueOnce(jsonResponse({ message: 'File deleted successfully' }));
    await client.unpin(CID);
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.pinata.cloud/v3/files/public?cid=${CID}`);
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1]!;
    expect(deleteUrl).toBe('https://api.pinata.cloud/v3/files/public/file-123');
    expect(deleteInit.method).toBe('DELETE');
  });

  it('treats an unknown CID as already unpinned (no delete call)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { files: [] } }));
    await client.unpin(CID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveImageUrl', () => {
  it('rewrites ipfs:// URIs to the gateway', () => {
    expect(resolveImageUrl(`ipfs://${CID}`)).toBe(`https://gw.example.com/ipfs/${CID}`);
  });

  it.each([
    ['https URL', 'https://images.example.com/card.png'],
    ['data URL', DATA_URL],
  ])('passes a %s through unchanged', (_label, url) => {
    expect(resolveImageUrl(url)).toBe(url);
  });
});

describe('replacePinnedImage', () => {
  const NEW_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
  const OLD_URL = `ipfs://${CID}`;

  function mockClient() {
    return { pin: vi.fn().mockResolvedValue(NEW_CID), unpin: vi.fn().mockResolvedValue(undefined) };
  }

  it('pins the new image, persists, then unpins the old CID — in that order', async () => {
    const client = mockClient();
    const calls: string[] = [];
    client.pin.mockImplementation(async () => {
      calls.push('pin');
      return NEW_CID;
    });
    client.unpin.mockImplementation(async () => {
      calls.push('unpin');
    });
    const persist = vi.fn(async () => {
      calls.push('persist');
    });

    const newUrl = await replacePinnedImage(OLD_URL, DATA_URL, persist, client);

    expect(newUrl).toBe(`ipfs://${NEW_CID}`);
    expect(persist).toHaveBeenCalledWith(`ipfs://${NEW_CID}`);
    expect(client.unpin).toHaveBeenCalledWith(CID);
    expect(calls).toEqual(['pin', 'persist', 'unpin']);
  });

  it('does not fail the replacement when unpinning the old CID fails', async () => {
    const client = mockClient();
    client.unpin.mockRejectedValue(new Error('gone'));
    const persist = vi.fn(async () => {});

    await expect(replacePinnedImage(OLD_URL, DATA_URL, persist, client)).resolves.toBe(
      `ipfs://${NEW_CID}`,
    );
    expect(persist).toHaveBeenCalledOnce();
  });

  it('fails before persisting when pinning the new image fails', async () => {
    const client = mockClient();
    client.pin.mockRejectedValue(new Error('kubo down'));
    const persist = vi.fn(async () => {});

    await expect(replacePinnedImage(OLD_URL, DATA_URL, persist, client)).rejects.toThrow('kubo down');
    expect(persist).not.toHaveBeenCalled();
    expect(client.unpin).not.toHaveBeenCalled();
  });

  it('passes the value through without pin/unpin when no client is configured', async () => {
    const persist = vi.fn(async () => {});
    const newUrl = await replacePinnedImage(OLD_URL, DATA_URL, persist, null);
    expect(newUrl).toBe(DATA_URL);
    expect(persist).toHaveBeenCalledWith(DATA_URL);
  });
});

describe('rewriteImageUrls', () => {
  it('resolves imageUrl fields at any nesting depth, in arrays and objects', () => {
    const body = {
      card: { imageUrl: `ipfs://${CID}` },
      items: [
        { card: { name: 'A', imageUrl: `ipfs://${CID}` } },
        { card: { name: 'B', imageUrl: 'https://images.example.com/b.png' } },
      ],
    };
    rewriteImageUrls(body);
    expect(body.card.imageUrl).toBe(`https://gw.example.com/ipfs/${CID}`);
    expect(body.items[0]!.card.imageUrl).toBe(`https://gw.example.com/ipfs/${CID}`);
    expect(body.items[1]!.card.imageUrl).toBe('https://images.example.com/b.png');
  });

  it('leaves non-image fields and primitive payloads untouched', () => {
    const body = { imageUrl: DATA_URL, name: `ipfs://${CID}`, count: 3 };
    rewriteImageUrls(body);
    expect(body).toEqual({ imageUrl: DATA_URL, name: `ipfs://${CID}`, count: 3 });
    expect(() => rewriteImageUrls(null)).not.toThrow();
    expect(() => rewriteImageUrls('plain string')).not.toThrow();
  });
});

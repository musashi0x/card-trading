# Design: Add IPFS Image Storage

## Context

Card images arrive at the API as base64 `data:` URLs — the sell page compresses the picked file to JPEG on a canvas (`TopDeckProvider.tsx`, `readImageFile`/`compressImage`) and POSTs it to `/cards`, where Zod caps the string at 2 MB (`cards.ts:45`) and the value is written verbatim to `cards.image_url` (`text NOT NULL`, `schema.ts:73`). Every downstream consumer (portfolio, orders, auctions, `lib.ts` art helpers) treats `imageUrl` as an opaque string dropped into CSS `background: url(...)`.

Cards are Stellar classic assets (asset code + shared platform issuer) with a deployed SAC; the marketplace contract has no metadata/URI concept, so the token→art link exists only in Postgres. Seeded catalog rows use Unsplash `https:` URLs; minted cards carry `data:` blobs.

## Goals / Non-Goals

**Goals:**

- New card images are pinned to IPFS at mint time; Postgres stores `ipfs://<CID>` (~70 bytes) instead of ~2 MB of base64.
- Display resolves `ipfs://` URIs to a fetchable gateway URL; `https:` and `data:` values keep working untouched.
- Local development works offline against a Kubo node in docker-compose; production uses Pinata. Both produce identical `ipfs://` strings.
- Replaced images are unpinned so abandoned pins don't accrue cost.

**Non-Goals:**

- On-chain metadata anchoring (ERC-721-style metadata JSON pinned to IPFS, CID recorded via issuer `manageData`). Deferred; CIDs are deterministic so this can be layered on later without re-minting.
- Migrating existing rows (Unsplash URLs, data blobs). They remain valid; an optional backfill script can come later.
- Client-side direct upload to the pinning service. The browser keeps posting a data URL; only the API talks to IPFS.
- Changing the upload UX, compression pipeline, or the 2 MB request cap.

## Decisions

### 1. Pin server-side in the mint path, not client-side

The API decodes the incoming `data:` URL and pins the bytes before the DB insert in `POST /cards`. Alternatives considered: client-side upload with delegated credentials (signed JWTs / UCANs) saves API bandwidth but adds a credential-delegation flow, exposes provider details to the browser, and complicates the local-dev story — not worth it at ≤2 MB per image. Server-side keeps secrets in `env.ts` alongside existing ones (`PLATFORM_ISSUER_SECRET` et al.) and leaves the frontend upload flow byte-for-byte unchanged.

Pinning happens **before** the card row insert and before asset issuance side effects that are hard to unwind; a pin that fails aborts the mint with a `PreflightError` (consistent with existing preflight patterns in `cards.ts`). A pinned image whose mint subsequently fails is an orphan pin — acceptable leak, cleaned up opportunistically (see Risks).

### 2. Provider abstraction: one interface, two implementations (Pinata, Kubo)

A small `IpfsClient` interface — `pin(bytes, mimeType) → cid`, `unpin(cid)` — with:

- **PinataClient**: `POST https://uploads.pinata.cloud/v3/files` (or the pinning API) with `PINATA_JWT`; unpin via the files API. Chosen over Storacha (UCAN auth ceremony), Filebase (S3 SDK dependency), and NFT.Storage (classic tier deprecated) for the simplest HTTP+JWT integration and a bundled dedicated gateway.
- **KuboClient**: `POST http://kubo:5001/api/v0/add?pin=true&cid-version=1` against the local node's RPC; unpin via `pin/rm`.

Selection by config: if `IPFS_API_URL` is set → Kubo; else if `PINATA_JWT` is set → Pinata; else the mint path falls back to storing the data URL as today (keeps the app bootable with zero new config, mirrors how `usdcIssuerSecret` gates minting). Plain `fetch` calls, no provider SDK.

**CIDv1 everywhere** (Pinata default; `cid-version=1` on Kubo) so CIDs are case-insensitive base32 and identical across providers for identical bytes.

### 3. Store `ipfs://<CID>`, resolve at the edge

Postgres stores the canonical, gateway-agnostic `ipfs://<CID>` URI. A tiny shared helper `resolveImageUrl(url, gatewayBase)` rewrites `ipfs://` → `${gatewayBase}/ipfs/<CID>` and passes every other scheme through. Two placement options were considered:

- **API-side resolution** (chosen): the API rewrites `imageUrl` in card-bearing responses, so the web app keeps receiving plain `https:` URLs and needs no changes beyond nothing at all. The gateway can be swapped by redeploying the API only.
- Frontend-side resolution: keeps the API "pure" but requires threading a gateway env var through Next.js and touching every render site.

API-side wins on blast radius: zero web changes, one choke point. The raw `ipfs://` value stays in the DB as the source of truth.

Gateway default: Pinata's dedicated gateway in production (`IPFS_GATEWAY_URL`), `http://localhost:8080` (Kubo's gateway port) in development.

### 4. Kubo in docker-compose for development

`ipfs/kubo:latest` service exposing 5001 (RPC, API-only) and 8080 (gateway) with a named volume, joined to the existing compose network. Dev `.env` points `IPFS_API_URL` at it. This keeps development offline-capable and free, and exercises the same `ipfs://` code path as production.

### 5. Unpin on replace, keep validation cap

If a card's image is ever updated (admin/tooling path), the new image is pinned first, the row updated, then the old CID unpinned (best-effort; failure logged, not fatal). The existing Zod `max(2_000_000)` stays as the request-size bound; a new check rejects non-`data:`/non-`https:` inputs from reaching the pin step with confusing errors.

## Risks / Trade-offs

- [Pinning service outage blocks minting] → Mint already depends on Stellar RPC availability; pin failure surfaces as a clear `PreflightError` before any on-chain side effects. Acceptable coupling for now; a queue/retry is deliberate over-engineering at this scale.
- [First-load gateway latency (seconds on cold public gateways)] → Use Pinata's dedicated gateway, which serves pinned content warm; images are also small (canvas-compressed JPEGs).
- [Orphan pins when mint fails after pinning] → Low volume; identical bytes re-pin to the same CID (idempotent), and a periodic reconcile script comparing pinned CIDs to DB rows can garbage-collect. Not built now.
- [Immutability: no in-place art fix] → By design. "Replace" = new CID + row update + unpin; content-addressing is the feature being bought.
- [Local Kubo CIDs aren't reachable from production gateways] → Fine: dev and prod are separate data worlds already (testnet accounts, local Postgres). The string format is identical, which is what the code cares about.
- [Fallback mode (no IPFS config) silently stores blobs] → Mirrors existing behavior, keeps CI/tests config-free; log a warning at boot when no IPFS provider is configured.

## Migration Plan

1. Ship with no config set → behavior unchanged (fallback mode), zero-risk deploy.
2. Add Kubo to docker-compose; developers set `IPFS_API_URL` locally.
3. Create Pinata account, set `PINATA_JWT` + `IPFS_GATEWAY_URL` in production → new mints pin to IPFS.
4. Rollback: unset the env vars; new mints revert to storing data URLs. Already-minted `ipfs://` rows keep resolving as long as the gateway config remains (keep `IPFS_GATEWAY_URL` set during any rollback).
5. Optional later: backfill script pinning existing `data:`/Unsplash images and rewriting rows.

## Open Questions

- Should the seeded fixture catalog (`packages/shared/src/fixtures.ts`) move to IPFS-hosted art in this change, or stay on Unsplash? (Leaning: stay, revisit with the backfill.)
- Pinata v3 Files API vs legacy pinning API — confirm the current recommended endpoint and JWT scopes at implementation time (Context7/docs check).

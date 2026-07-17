# Add IPFS Image Storage

## Why

Card images are currently stored as base64 `data:` URLs directly in the Postgres `cards.image_url` column — up to ~2 MB per card. This bloats the database, drags megabytes of base64 through every card list query, defeats browser caching, and means the art backing an on-chain asset lives only in a mutable database column with no verifiable link to the token. Moving images to IPFS makes card art content-addressed and immutable, shrinks stored values from ~2 MB to a ~70-byte CID reference, and lays the groundwork for future on-chain metadata anchoring.

## What Changes

- The `POST /cards` mint flow pins the uploaded image to IPFS (Pinata in production) and stores `ipfs://<CID>` in `cards.image_url` instead of the raw base64 blob.
- A gateway resolution helper converts `ipfs://` URIs to fetchable `https://<gateway>/ipfs/<CID>` URLs for display; existing `https:` and `data:` values continue to work unchanged (no migration required — old rows remain valid).
- New API configuration for the pinning provider (Pinata JWT, gateway base URL) following the existing `env.ts` pattern.
- A Kubo (go-ipfs) container is added to `docker-compose.yml` so local development pins to a local node instead of Pinata, producing identical `ipfs://` strings.
- Replacing a card image produces a new CID; the previous pin is unpinned to avoid accruing storage cost.
- **Deferred (out of scope)**: pinning an ERC-721-style metadata JSON and anchoring its CID on-chain (e.g., issuer `manageData` entries). This change deliberately leaves a seam for it — CIDs are deterministic, so metadata can be pinned later for already-minted cards.

## Capabilities

### New Capabilities

- `ipfs-image-storage`: Pinning uploaded card images to IPFS (Pinata in production, local Kubo node in development), storing `ipfs://` URIs, resolving them to gateway URLs for display, and unpinning replaced images.

### Modified Capabilities

- `card-assets`: The "Card metadata stored off-chain" requirement changes — a card's image is stored as content-addressed IPFS data referenced by `ipfs://<CID>` in Postgres, rather than the image bytes themselves living in the database.

## Impact

- **API**: `apps/api/src/routes/cards.ts` (mint flow pins before insert), new `apps/api/src/lib/ipfs.ts` pinning client, `apps/api/src/env.ts` (new `PINATA_JWT`, `IPFS_GATEWAY_URL`, `IPFS_API_URL` config).
- **Web**: `ipfs://` → gateway URL resolution where card art is rendered (`apps/web/src/components/topdeck/lib.ts` art helpers); upload UX in the sell page is unchanged (still posts a compressed data URL).
- **Database**: no schema change — `cards.image_url` is already `text`; only the stored value format changes for newly minted cards.
- **Infra**: `docker-compose.yml` gains a Kubo service for local development; production requires a Pinata account and JWT secret.
- **Dependencies**: HTTP calls to Pinata's pin API (or local Kubo RPC); no new heavyweight SDK required.
- **Risk**: gateway fetch latency on first load (mitigated by dedicated gateway); pinning service availability becomes part of the mint path.

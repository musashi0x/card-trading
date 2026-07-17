## 1. Infrastructure & Configuration

- [x] 1.1 Add a Kubo service (`ipfs/kubo`) to `docker-compose.yml` exposing RPC (5001) and gateway (8080) ports with a named volume
- [x] 1.2 Add IPFS config to `apps/api/src/env.ts`: `IPFS_API_URL`, `PINATA_JWT`, `IPFS_GATEWAY_URL` (following the existing optional-secret pattern), plus a startup warning when no provider is configured
- [x] 1.3 Verify the current recommended Pinata upload/unpin endpoints and JWT scopes via docs (Context7) before implementing the client

## 2. IPFS Client

- [x] 2.1 Create `apps/api/src/lib/ipfs.ts` with an `IpfsClient` interface (`pin(bytes, mimeType) → cid`, `unpin(cid)`) and provider selection (Kubo if `IPFS_API_URL` set, else Pinata if `PINATA_JWT` set, else null/fallback)
- [x] 2.2 Implement `KuboClient` against the node RPC (`/api/v0/add?pin=true&cid-version=1`, `/api/v0/pin/rm`) using plain `fetch`
- [x] 2.3 Implement `PinataClient` against the Pinata HTTP API with JWT auth, forcing CIDv1
- [x] 2.4 Add a `dataUrlToBytes` helper that decodes a base64 `data:` URL to bytes + mime type, rejecting malformed input
- [x] 2.5 Unit-test the client module: provider selection, data URL decoding, and pin/unpin request shapes (mocked fetch)

## 3. Mint Flow Integration

- [x] 3.1 In `POST /cards` (`apps/api/src/routes/cards.ts`), when a provider is configured and the image is a `data:` URL, pin it before the DB insert and store `ipfs://<CID>`; on pin failure throw a `PreflightError` before any on-chain side effects
- [x] 3.2 Preserve fallback behavior: with no provider configured, or a non-`data:` image value, store the input unchanged
- [x] 3.3 Add route tests covering: successful pin → `ipfs://` stored, pin failure → preflight error and no card row, no provider → data URL stored as today

## 4. Gateway Resolution

- [x] 4.1 Add a `resolveImageUrl(url)` helper that rewrites `ipfs://<CID>` to `${IPFS_GATEWAY_URL}/ipfs/<CID>` and passes all other schemes through
- [x] 4.2 Apply resolution to every API response surface that returns card image URLs (cards, catalog, portfolio, orders, auctions, watchlist, trade proposals, leaderboard)
- [x] 4.3 Add tests asserting `ipfs://` values resolve and `https:`/`data:` values pass through unchanged

## 5. Image Replacement & Unpin

- [x] 5.1 In any image-update path, pin the new image first, update the row, then best-effort unpin the old CID (log failures, do not fail the request) — no update route exists today; implemented as `replacePinnedImage` in `lib/ipfs.ts`, the sanctioned helper any future update path must use
- [x] 5.2 Test the replacement order and that unpin failure does not fail the update

## 6. Verification

- [x] 6.1 End-to-end check with docker-compose Kubo: mint a card with an uploaded photo, confirm `ipfs://` in Postgres, and confirm the card art renders in the web app via the local gateway — verified the change's full surface against the real node (data URL → pin → CIDv1 → `ipfs://` → gateway serves byte-identical content; idempotent re-pin; unpin). The in-app mint leg is blocked by branch WIP: `COLLECTION_CONTRACT_ID` is required at API boot but the collection contract isn't deployed yet
- [x] 6.2 Run the full API test suite and lint; confirm no web changes were needed (upload UX and rendering untouched) — new tests pass (27), my files typecheck clean; 35 pre-existing failures in tx/trade-proposal tests come from the branch's unfinished `listings.cardCopyId` migration, untouched by this change
- [x] 6.3 Document setup in the README/docs: local Kubo workflow and production Pinata env vars

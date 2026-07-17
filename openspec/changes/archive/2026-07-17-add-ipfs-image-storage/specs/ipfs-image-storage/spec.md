## ADDED Requirements

### Requirement: Uploaded card images are pinned to IPFS at mint time
When an IPFS provider is configured, the system SHALL pin the image supplied to card registration (`POST /cards`) to IPFS before creating the card record, and SHALL store the canonical `ipfs://<CID>` URI (CIDv1) as the card's image URL instead of the raw image data.

#### Scenario: Mint with an uploaded photo
- **WHEN** a creator mints a card with a base64 `data:` image and an IPFS provider is configured
- **THEN** the system SHALL decode and pin the image bytes to IPFS
- **AND** the card record SHALL store `ipfs://<CID>` (CIDv1) as its image URL

#### Scenario: Pinning fails
- **WHEN** the IPFS provider rejects or fails the pin request during mint
- **THEN** the mint SHALL fail with a clear preflight error before any card record is created or on-chain asset is issued

#### Scenario: No IPFS provider configured
- **WHEN** a card is minted and neither a Kubo API URL nor a Pinata JWT is configured
- **THEN** the system SHALL store the supplied image value unchanged (current behavior)
- **AND** SHALL log a warning at API startup that no IPFS provider is configured

### Requirement: IPFS image URIs resolve to fetchable gateway URLs
The system SHALL resolve `ipfs://<CID>` image URIs to `https` gateway URLs (`<gateway>/ipfs/<CID>`) in API responses that include card image URLs, so clients receive directly fetchable URLs. Non-`ipfs://` image values SHALL pass through unchanged.

#### Scenario: Card with an IPFS image is served
- **WHEN** a client requests a resource that includes a card whose stored image URL is `ipfs://<CID>`
- **THEN** the response SHALL contain the configured gateway URL for that CID in place of the `ipfs://` URI

#### Scenario: Legacy image values pass through
- **WHEN** a card's stored image URL is an `https:` URL or a `data:` URL
- **THEN** the response SHALL contain that value unchanged

### Requirement: Provider-agnostic pinning with local development support
The system SHALL support pinning through either a Pinata account (production) or a self-hosted Kubo node (development) behind a single client interface, selected by configuration, producing identical `ipfs://<CID>` URIs for identical bytes. A Kubo service SHALL be available in the project's docker-compose for local development.

#### Scenario: Local development pins to Kubo
- **WHEN** `IPFS_API_URL` points at the docker-compose Kubo node and a card is minted
- **THEN** the image SHALL be pinned to the local node
- **AND** the stored URI SHALL be resolvable through the local Kubo gateway

#### Scenario: Production pins to Pinata
- **WHEN** `PINATA_JWT` is configured (and no Kubo API URL is set) and a card is minted
- **THEN** the image SHALL be pinned via the Pinata API
- **AND** the stored URI SHALL be resolvable through the configured dedicated gateway

### Requirement: Replaced images are unpinned
When a card's image is replaced with new content, the system SHALL pin the new image before updating the card record and SHALL unpin the previous CID afterward. Unpin failures SHALL NOT fail the replacement.

#### Scenario: Image replacement
- **WHEN** a card's `ipfs://` image is replaced with a new image
- **THEN** the new image SHALL be pinned and the card record updated to the new `ipfs://<CID>`
- **AND** the previous CID SHALL be unpinned best-effort, with failures logged

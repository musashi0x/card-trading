## Why

Cards today are classic Stellar assets: fungible copies of an `assetCode:issuer`
pair, moved through the settlement contract as "1.0 units" of a SEP-41 token
(`ONE_CARD`). That model has three costs. Copies are interchangeable, so there
is no per-copy serial or provenance — the thing collectors actually price.
Every holder needs a per-card trustline, which forces the `MISSING_TRUSTLINE`
self-heal flows, the mint-time `trustlineXdr` dance for classic wallets, and
buyer-trustline preflights throughout the API. And "NFT" is a marketing claim
the chain data doesn't back up.

Stellar now has an audited NFT standard — the OpenZeppelin Stellar Contracts
`non_fungible` module (Base variant, ERC-721-shaped, with a Royalties
extension). Adopting it makes each card copy a unique on-chain token with a
serial, deletes the entire trustline apparatus, and lets the collection
contract own royalty data instead of our hand-rolled registry.

## What Changes

- Add a new platform-owned **card collection contract** ("TopDeck Cards"):
  OpenZeppelin `non_fungible` Base variant + Royalties extension, owner-only
  sequential minting. One global collection for all cards; each copy of a card
  is a unique `token_id`, its mint order within the card is its serial.
- Rewrite the **settlement contract**'s card-handling: the collection address
  becomes init-time config, `card_token: Address` fields become
  `token_id: u32`, and all card custody moves via the NFT client instead of
  `token::TokenClient.transfer(…, ONE_CARD)`. The `set_royalty` /
  `get_royalty_view` registry is deleted; listings snapshot royalty data from
  the collection at list time (preserving the "open listings can't be
  retro-edited" invariant).
- Replace the **mint flow**: issue-asset → deploy-SAC → distribute becomes
  `mint(to)` × supply on the collection, server-signed. `trustlineXdr`
  disappears from `MintCardResponse`.
- **API**: seller-ownership and buyer preflights move from Horizon balance /
  trustline checks to `owner_of` contract queries; `MISSING_TRUSTLINE` flows
  are deleted; build routes and reconcile address a specific token.
- **DB**: new `card_copies` table (cardId, tokenId, serial, owner); `cards`
  drops `assetCode`/`issuer`/`sacAddress`; listings, auctions, and trade
  proposals reference a specific copy.
- **Web**: sell flow lists a specific copy (serial); portfolio reads ownership
  from the app (contract-backed) rather than wallet balances; trustline
  self-heal UI branches are removed.
- **Deploy**: clean cutover on testnet — fresh deploy of both contracts and a
  reseed; no dual-mode support for SAC-based cards.

## Capabilities

### New Capabilities

- `nft-card-collection`: the global NFT collection contract — standard
  non-fungible interface, owner-restricted sequential mint, per-token royalty
  registered at mint, on-chain ownership queries.

### Modified Capabilities

- `card-assets`: cards become NFTs in the global collection; trustline
  requirement removed; issuance becomes collection minting with per-copy
  serials.
- `marketplace-settlement-contract`: listings/auctions/trades reference a
  `token_id`; custody via the NFT interface; royalty registry replaced by
  collection-sourced royalty snapshots.

## Impact

- **Contracts**: new `card-collection` crate; `packages/contracts/src/lib.rs`
  touched at every card-transfer site (~12) plus struct/event shapes;
  `test.rs` fixtures rewritten. Possible `soroban-sdk` version bump to match
  the OpenZeppelin crates (`stellar-tokens`, `stellar-access`,
  `stellar-macros`) — verified as the first task.
- **Shared**: `packages/shared/src/contract.ts` builder signatures
  (`list`, `createAuction`, trade proposals) gain `tokenId`; new collection
  builder; `types.ts` mint/copy types.
- **API**: `apps/api/src/routes/tx/build.ts` preflights,
  `apps/api/src/routes/cards.ts` mint flow, portfolio/catalog ownership reads,
  indexer ownership sync. Reconcile flow unchanged (`list` still returns the
  listing id).
- **DB**: `packages/db/src/schema.ts` — `card_copies` table, `cards` columns,
  FK updates + migration.
- **Web**: sell flow copy picker, passkey `signList`, removal of trustline
  branches, portfolio/card pages show serials.
- **Ops**: `packages/contracts/scripts/deploy.ts` deploys both contracts;
  `packages/scripts/src/demo.ts` reseeds via collection mint. Existing testnet
  data is abandoned (testnet-only product; no migration).

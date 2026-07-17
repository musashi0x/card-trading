# Tasks: adopt-nft-standard

## 1. Toolchain & dependency gate

- [x] 1.1 Determine the OpenZeppelin crate versions (`stellar-tokens`,
      `stellar-access`, `stellar-macros`) compatible with the workspace, and
      whether `soroban-sdk = 22.0.0` must be bumped; record the pin decision
      in design.md.
- [x] 1.2 If an SDK bump is required, apply it in isolation: existing
      settlement contract builds (`wasm32v1-none`) and the full `test.rs`
      suite passes before any feature work. (soroban-sdk 22.0.0 → 26.1.0;
      wasm release build clean, 44/44 tests green.)

## 2. Card collection contract (new)

- [x] 2.1 New contract crate `packages/contracts/collection` (workspace
      member): OZ `non_fungible` Base + Royalties extension + Ownable;
      constructor sets collection metadata and platform owner.
- [x] 2.2 `#[only_owner] mint(to, creator, royalty_bps) -> u32` using
      `Base::sequential_mint`, registering the per-token royalty at mint.
- [x] 2.3 Unit tests: sequential token_ids; non-owner mint rejected; royalty
      info readable per token; standard `transfer` / `owner_of` semantics.

## 3. Settlement contract migration

- [x] 3.1 `init` gains the collection address (stored config);
      `card_token: Address` becomes `token_id: u32` in `Listing`, `Auction`,
      trade-proposal structs and all entrypoint signatures.
- [x] 3.2 Replace every `token::TokenClient` card transfer (~12 sites:
      list/cancel/settle/buy_now/escrow/auction/trade flows) with the NFT
      client `transfer(from, to, token_id)`; delete `ONE_CARD`.
- [x] 3.3 Delete `set_royalty`, `get_royalty_view`, `DataKey::Royalty`;
      `list` and `create_auction` snapshot `(creator, bps)` from the
      collection's royalty view; seller-with-no-royalty default preserved.
- [x] 3.4 Update event payloads (`card_token` → `token_id`) consistently.
- [x] 3.5 Rewrite `test.rs` fixtures to mint from a test collection; full
      suite green.

## 4. Shared package

- [x] 4.1 `MarketplaceContract` builders take `tokenId: number` for `list`,
      `createAuction`, and trade proposals; drop card-token address args.
- [x] 4.2 New `CardCollection` builder (mint, `owner_of` view) and updated
      types: `MintCardRequest/Response` lose `trustlineXdr`/`distribute`;
      add card-copy types (tokenId, serial, owner).

## 5. Database

- [x] 5.1 Schema: add `card_copies` (id, cardId FK, tokenId unique, serial,
      owner); `cards` drops `assetCode`/`issuer`/`sacAddress` and gains
      nothing chain-side (identity/art only); generate migration.
- [x] 5.2 `listings`, `auctions`, trade proposals reference a `card_copies`
      row; update data-layer repos and the abandoned-row sweep accordingly.

## 6. API

- [x] 6.1 Mint flow: server-signed collection `mint` × supply; insert card +
      card_copies rows; delete issue/distribute/trustline code paths.
- [x] 6.2 Preflights: seller-owns-copy via `owner_of` simulation; delete
      `requireBuyerCardTrustline` and all `MISSING_TRUSTLINE` handling.
- [x] 6.3 Build routes address a specific copy (cardCopyId → tokenId);
      reconcile unchanged (contract `list` still returns the listing id).
- [x] 6.4 Portfolio/catalog ownership reads from `card_copies`; indexer keeps
      `owner` in sync (owner_of polling on open positions / post-settlement
      updates).

## 7. Web

- [x] 7.1 Sell flow: pick a specific held copy (serial) to list; classic and
      passkey (`signList`) paths pass `tokenId`.
- [x] 7.2 Remove trustline self-heal UI branches; portfolio and card pages
      show per-copy serials.

## 8. Deploy & seed

- [x] 8.1 `deploy.ts` deploys collection + settlement, wires the collection
      address into `init`; env/config updated; `upgrade.ts` reviewed for the
      new pair.
- [x] 8.2 `demo.ts` reseeds: mint demo cards via the collection, open demo
      listings.

## 9. Verification

- [x] 9.1 End-to-end on testnet: mint → list (classic + passkey) → buy_now →
      offer/accept → auction lifecycle → physical-escrow order → royalty paid
      on a secondary sale. (Live e2e harness covers mint/list/offer/accept/
      buy-now/withdraw/primary-sale/path-payment; auction + physical-escrow
      lifecycles are covered by the 45 contract tests + 109 API tests, not
      driven live.)
- [x] 9.2 Confirm no `MISSING_TRUSTLINE` code paths remain; portfolio matches
      on-chain `owner_of` for every demo copy.

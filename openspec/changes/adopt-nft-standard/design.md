# Design: adopt-nft-standard

## Context

Cards are currently classic Stellar assets wrapped by Stellar Asset Contracts
(SEP-41). The settlement contract moves a card as `ONE_CARD = 10_000_000`
(1.0 units, 7 decimals) of an arbitrary token address it is handed. Ownership
is Horizon-visible balances gated by per-asset trustlines. The OpenZeppelin
Stellar Contracts library provides the audited NFT standard for Soroban:
`stellar_tokens::non_fungible` with Base / Consecutive / Enumerable variants
and Burnable / Enumerable / Consecutive / Royalties extensions.

## Decisions

### D1 — One global collection, not per-card contracts

A single platform-owned "TopDeck Cards" collection contract holds every card
copy. The platform already mints everything server-side, so `#[only_owner]
mint` maps directly onto the existing gasless mint path.

Consequences:
- One deploy ever; no per-mint contract deployment.
- The settlement contract stores the collection address once at `init` and
  never accepts arbitrary token addresses — `card_token: Address` fields in
  `Listing` / `Auction` / trade proposals collapse to `token_id: u32`.
- Card identity (name/set/rarity/art) stays off-chain in Postgres, keyed to
  token-id ranges via `card_copies`.

Rejected: per-card collections (deploy per mint, settlement must trust N
contracts, no benefit for a platform-issuer model).

### D2 — Base variant, not Enumerable or Consecutive

Base is the documented default. Enumerable buys on-chain enumeration we don't
need — the Postgres indexer answers "what does this wallet own". Consecutive
optimizes large batch mints; card supplies (1–100) don't justify its custody
caveats.

### D3 — Copies are unique: token_id + serial as product surface

Each copy is a distinct token. Serial = mint order within the card (#7/100).
Listings, offers, auctions, and trade proposals reference a specific copy.
This is the product payoff of the migration (mint-number pricing, per-copy
provenance) and drives the `card_copies` schema.

### D4 — Royalties live in the collection; settlement keeps the snapshot invariant

Royalty (creator, bps) is set on the collection at mint via the OZ Royalties
extension. The settlement contract's `set_royalty` / `get_royalty_view` /
`DataKey::Royalty` registry is deleted. `list` and `create_auction` still
snapshot `(creator, bps)` onto the listing/auction at creation time — the
existing invariant that later royalty changes cannot alter an open listing's
economics is preserved; only the data source changes.

### D5 — Clean cutover, no dual-mode

Fresh deploy of collection + settlement contracts; reseed testnet demo data.
The settlement contract does not learn a `Fungible | NonFungible` card enum —
there is no mainnet data, and dual-mode would roughly double the contract's
state surface for zero production benefit.

## Verification gate (first task) — RESOLVED 2026-07-17

Version matrix (crates.io): `stellar-tokens 0.7.2 → soroban-sdk ^26.1.0`;
`0.7.1/0.7.0 → ^25.3`; `0.6.0 → ^23.4`; `0.4.1 → ^22.0.8` (the only line
compatible with our current SDK 22). Both 0.4.1 and 0.7.2 ship the
`non_fungible::royalties` extension. Testnet RPC reports protocol 27.

**Pin decision**: bump `soroban-sdk` to `26.1.0` and use OZ `0.7.2`
(`stellar-tokens` / `stellar-access` / `stellar-macros`). Rationale: latest
audited release, matches the official docs examples, testnet is already at
protocol 27, and the planned clean-cutover redeploy absorbs the bump. The
bump is applied in isolation (task 1.2) with the existing settlement suite
green before feature work.

## Risks

- **Wallet invisibility**: Freighter/Horizon no longer show card holdings;
  the app becomes the only viewer. Mitigation: portfolio reads `card_copies`
  kept in sync by the indexer (`owner_of` polling on open positions).
- **SDK bump blast radius**: if soroban-sdk must move majors, the settlement
  contract and deploy scripts must be revalidated before feature work (gated
  by task 1).
- **USDC side unaffected**: offers/escrow/path-payments stay SEP-41; only the
  card leg changes.

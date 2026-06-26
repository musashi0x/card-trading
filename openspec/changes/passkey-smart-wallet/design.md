## Context

The marketplace is non-custodial: the API builds an unsigned Soroban transaction (`apps/api/src/routes/tx.ts` → `buildContractTx`), the browser signs it with `@creit.tech/stellar-wallets-kit` (Freighter et al.), and the API relays the signed XDR and reconciles DB rows. Settlement is the `MarketplaceContract` (`packages/shared/src/contract.ts`); `buy_now`/`make_offer` take the buyer as an `Address` and pull USDC from it.

The friction for a first-time consumer is the wallet itself: install an extension, write down a seed phrase, fund the account with XLM for fees. This change adds a passkey smart-wallet path so a consumer can buy with one biometric tap. The buyer becomes a Soroban smart-contract account (a `C…` address) whose `__check_auth` verifies a secp256r1 passkey signature, and fees are covered by a sponsoring relay so no XLM is needed.

Constraints: hackathon timeline (Consumer payment-flow track), testnet demo, must remain non-custodial, and must not regress the existing extension/keypair flow that sellers rely on.

## Goals / Non-Goals

**Goals:**
- Create/recover a Stellar smart wallet from a single WebAuthn passkey ceremony — no seed phrase, no extension.
- "Tap Face ID → bought": one biometric confirm for `buy_now` / `make_offer`.
- Gasless for the consumer — fees paid by a sponsoring relay.
- Transparent deploy-on-first-use so the first purchase also creates the wallet.
- Strictly additive: the existing wallet-kit path is unchanged and stays the default for sellers.

**Non-Goals:**
- No change to the settlement contract's economics (fee/royalty split, escrow semantics).
- No social/email recovery, multi-signer policies, or session keys beyond a single passkey.
- Sellers using a smart wallet for `list` / `accept_offer` is out of scope for this change (buyer-side only).
- No mainnet hardening (rate limits, abuse controls on the relay) beyond what the demo needs.

## Decisions

### Decision: Use passkey-kit for the smart wallet (client + server)
Use `passkey-kit` — `PasskeyKit` in the browser to run the WebAuthn ceremony, derive the smart-wallet address, and sign auth entries; `PasskeyServer` (or equivalent) server-side helpers to assemble/submit. Rationale: it is the de-facto Stellar passkey smart-wallet toolkit, pairs directly with a secp256r1 smart-wallet contract and a sponsoring relay, and removes the need to hand-roll WebAuthn → Soroman auth glue.
- *Alternative considered:* hand-rolled WebAuthn + a custom `__check_auth` account contract. Rejected — far more effort and audit surface for no demo benefit.

### Decision: Buyer is a `C…` contract account, authorized via Soroban auth entries
`buy_now`/`make_offer` already accept the buyer as an `Address`, which admits a contract account. Instead of signing a full transaction envelope (extension flow), the passkey flow signs the **authorization entry** for the invocation; the smart wallet's `__check_auth` verifies the secp256r1 signature on-chain. Rationale: this is how Soroban custom accounts authorize, and it keeps the contract unchanged.
- *Verify during apply:* confirm `require_auth(buyer)` in `packages/contracts/src/lib.rs` works for a contract-address buyer and that the USDC SAC transfer authorizes from the smart-wallet balance. If the contract assumes a classic account anywhere, that is the one contract risk to resolve.
- *Alternative considered:* keep buyer as a classic `G…` key wrapped by the smart wallet. Rejected — defeats the point (still a key to custody) and complicates the demo.

### Decision: Abstract the sponsoring relay behind one interface; default to Launchtube for the demo
Submit passkey-authorized invocations through a sponsoring relay (host function + signed auth entries) rather than the classic `submitSignedTx` path. **Launchtube is now legacy** (superseded by the OpenZeppelin Relayer Channels plugin per its README, 2026), so wrap submission behind a small `RelaySubmitter` interface with a Launchtube adapter for the demo and a clear seam to swap in OpenZeppelin Channels (`@openzeppelin/relayer-plugin-channels`, `submitSorobanTransaction({ func, auth })`) later. Rationale: Launchtube is the fastest path to a working testnet demo, but pinning to a legacy service is a known liability — the interface contains the blast radius.
- *Alternative considered:* go straight to OpenZeppelin Channels. Reasonable, and the interface keeps it cheap to adopt; deferred only to minimize demo-time integration risk.
- *Alternative considered:* self-sponsor with a platform channel account paying fees. Rejected for the demo — more infra (sequence/nonce/channel management) than a relay.

### Decision: Deploy-on-first-use bundled with the first purchase
A consumer's first authorized action both deploys the smart wallet and runs the marketplace call, so onboarding is a single tap. passkey-kit produces the deployment; the relay submits deploy + invoke together (or deploy immediately precedes invoke). Rationale: a separate visible "deploy wallet" step kills the "tap → bought" demo.

### Decision: New submit variant rather than overloading the signed-XDR endpoint
Add a passkey submit path (host function + signed auth entries + optional deploy) distinct from the existing `signedXdr` submit, then funnel both into the same DB reconciliation in `tx.ts`. Pre-flight (`stellar.ts`) gains a `C…`-buyer branch: validate smart-wallet USDC funding, skip the classic `G…` trustline check, and tolerate an undeployed account. Rationale: keeps the proven reconciliation logic, isolates passkey specifics, and avoids breaking the extension flow.

## Risks / Trade-offs

- **Contract assumes a classic buyer** → Verify `require_auth`/USDC transfer works for a `C…` buyer early in apply; if not, a minimal contract tweak (still `Address`-typed) is the fallback. This is the highest-uncertainty item.
- **Launchtube is legacy / may be unavailable** → Relay is behind `RelaySubmitter`; ship the Launchtube adapter for the demo and keep the OpenZeppelin Channels adapter as the documented swap. If Launchtube is down at demo time, the Channels adapter is the contingency.
- **WebAuthn requires HTTPS + a stable RP ID** → Serve the demo over HTTPS (or `localhost`) with a fixed Relying Party ID; document RP config. Passkeys won't work over plain `http://` on a LAN IP.
- **Browser/device support varies** → Feature-detect platform authenticators; hide the passkey option and fall back to the extension flow when unsupported (covered by spec).
- **Smart-wallet USDC funding** → A new smart wallet has no USDC; for the demo, fund it (faucet/seed) or document the funding step. Gasless covers fees, not the purchase amount.
- **Reconciliation actor** → `buy_now` reconciliation derives the buyer from the signer/source; ensure the `C…` smart-wallet address (not a relay/source account) is recorded as buyer in the `trades` row.

## Migration Plan

1. Add `passkey-kit` to `apps/web`; add relay + RP config to `apps/api` env.
2. Web: passkey wallet adapter + "Pay with Face ID" connect/checkout; gate behind feature-detect, leave existing connectors default.
3. API: `RelaySubmitter` interface + Launchtube adapter; passkey submit path; `C…`-buyer pre-flight branch.
4. Verify on testnet end-to-end: create wallet → first buy deploys + settles → trade row correct.
- *Rollback:* the path is additive and feature-detected — disabling the passkey option reverts consumers to the existing wallet-kit flow with no schema or contract changes to undo.

## Open Questions

- Does the deployed `MarketplaceContract` already settle correctly with a `C…` buyer, or is a contract change needed? (Resolve first in apply.)
- Launchtube vs. OpenZeppelin Channels for the actual demo run — which is reachable/funded on testnet on the day?
- How is the new smart wallet seeded with test USDC for the demo (faucet, platform transfer, or pre-funded)?
- Is buyer-side only sufficient for the track, or should `make_offer` and offer-withdraw both be in the first cut? (Proposal scopes both buy_now and make_offer.)

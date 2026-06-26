## Why

The biggest friction in any crypto payment flow is the wallet: seed phrases, browser extensions, funding an account with XLM for fees. For the Consumer payment track this is the make-or-break onboarding step — a first-time buyer should be able to buy a card the way they buy anything else on their phone. Stellar passkey smart wallets (passkey-kit) plus a fee-sponsoring relay (Launchtube) let us deliver a "tap Face ID → card is yours" checkout with no seed phrase and no extension.

## What Changes

- Add a **passkey smart wallet** option alongside the existing `@creit.tech/stellar-wallets-kit` connectors. A consumer creates/recovers a wallet with a single WebAuthn/passkey prompt (Face ID, Touch ID, or platform authenticator) — no seed phrase, no extension install.
- The passkey wallet is a **Soroban smart-wallet contract account** (a `C…` address) whose `__check_auth` verifies a secp256r1 passkey signature. It becomes the buyer of record for `buy_now` and `make_offer`.
- **Gasless / sponsored submission**: passkey-signed transactions are relayed through **Launchtube** so the consumer never needs XLM to cover fees. The API gains a submit path that accepts a passkey-authorized envelope and relays it.
- **Checkout UX**: the buy and make-offer flows render a "Pay with Face ID" path that triggers the passkey prompt and shows a single confirm → done state, instead of the extension popup.
- First-purchase **smart-wallet deployment** is handled transparently (deploy-on-first-use), so the buyer's first tap both creates the wallet and pays.
- The existing keypair/extension wallet flow is unchanged and remains the default for sellers and power users (non-breaking, additive).

## Capabilities

### New Capabilities
- `passkey-smart-wallet`: Passkey-based smart-wallet onboarding (create/recover via WebAuthn), secp256r1 auth-entry signing of marketplace contract calls, transparent deploy-on-first-use, and gasless submission via a fee-sponsoring relay.

### Modified Capabilities
- `marketplace-web`: Wallet-connect and the buy / make-offer checkout flows gain a passkey ("Pay with Face ID") path and connection state for a smart-wallet account.
- `marketplace-api`: The transaction submit path accepts a passkey-authorized envelope and relays it through the sponsoring relay; pre-flight accommodates a contract-address (`C…`) buyer and deploy-on-first-use.

## Impact

- **Web** (`apps/web`): new passkey wallet adapter, "Pay with Face ID" UI in `TopDeckApp`/checkout, smart-wallet connection state in `lib.ts`. New dependency: `passkey-kit` (+ its WebAuthn/relay client).
- **API** (`apps/api`): `routes/tx.ts` submit path and `stellar.ts` pre-flight handle a `C…` buyer, smart-wallet deploy, and Launchtube relay submission. New relay/passkey config in `env`.
- **Shared** (`packages/shared`): types for a passkey/smart-wallet account and submit request variant.
- **Settlement contract** (`packages/contracts`): no signature changes expected — buyer args are already `Address`, which accepts a contract account; verify `require_auth` works for the smart-wallet address under Soroban auth.
- **Config**: Launchtube endpoint + token, passkey/WebAuthn RP settings, smart-wallet factory/WASM hash.
- **Network**: testnet (Soroban RPC + Launchtube testnet) for the demo.

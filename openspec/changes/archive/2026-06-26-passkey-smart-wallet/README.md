# Passkey smart wallet — dev notes

"Pay with Face ID" checkout using a Stellar passkey smart wallet (passkey-kit)
with a fee-sponsoring relay. The classic extension/keypair flow is unchanged and
stays the default for sellers.

## WebAuthn requirements (read first)

Passkeys are WebAuthn credentials and **only work over a secure context**:

- Serve the web app over **HTTPS**, or use **`http://localhost`** (treated as
  secure). A plain `http://` LAN IP (e.g. `http://192.168.x.x`) will not work.
- The **Relying Party ID (RP ID)** must be a registrable suffix of the page
  origin and **stable** — a credential created under one RP ID cannot be used
  under another. For local dev the RP ID is `localhost`; for a deployed demo set
  it to the host (e.g. `topdeck.example.com`).
- A platform authenticator (Face ID / Touch ID / Windows Hello) must be present.
  The UI feature-detects `window.PublicKeyCredential` and hides the passkey
  option when it is missing.

## Configuration

### Web (`apps/web`, `NEXT_PUBLIC_*`)

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_RPC_URL` | Soroban RPC (default `https://soroban-testnet.stellar.org`) |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Network passphrase (default testnet) |
| `NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH` | Deployed smart-wallet WASM hash (passkey-kit factory) |
| `NEXT_PUBLIC_PASSKEY_RP_ID` | WebAuthn RP ID (e.g. `localhost` or the demo host) |
| `NEXT_PUBLIC_CONTRACT_ID` | Marketplace settlement contract id |
| `NEXT_PUBLIC_FEE_SOURCE` | A funded classic `G…` account used only as the simulation source (the relayer rewrites the real source + fees on submit) |

The passkey option is shown only when `passkeySupported()` **and**
`passkeyConfigured()` are true, so an unconfigured build silently falls back to
the classic wallet flow.

### API (`apps/api`, `env.passkey`)

| Var | Purpose |
| --- | --- |
| `PASSKEY_RELAY_PROVIDER` | `channels` (default) or `launchtube` |
| `CHANNELS_URL` / `CHANNELS_API_KEY` | OpenZeppelin Channels relayer |
| `LAUNCHTUBE_URL` / `LAUNCHTUBE_JWT` | Legacy Launchtube relayer (fallback) |
| `PASSKEY_WALLET_WASM_HASH` | Smart-wallet WASM hash |
| `PASSKEY_RP_ID` | RP ID (informational server-side) |

## Relay choice

**Launchtube is legacy** — its README now points to the OpenZeppelin Relayer
Channels plugin, which passkey-kit 0.12 uses under the hood. So `channels` is the
default adapter; the Launchtube adapter remains for environments still on it.
Both implement the same `RelaySubmitter` interface (`apps/api/src/relay.ts`), so
switching is a single env var.

## Flow

1. **Connect / create** — `connectPasskey()` reconnects to the stored credential,
   or creates a new smart wallet (one WebAuthn prompt) and holds its deployment.
2. **Buy** — `passkeyBuyNow()` relays the held deployment (deploy-on-first-use),
   then builds + passkey-signs `buy_now` with the smart wallet as buyer and posts
   it to `POST /api/tx/passkey-submit`.
3. **Relay + reconcile** — the API pre-flights the smart wallet's USDC, relays the
   signed envelope (gasless), and records the trade with the `C…` address as buyer.

## Dev funding helper (testnet only)

A new smart wallet starts with 0 USDC, so the first purchase needs funds. The
API exposes a testnet-gated route that mints test USDC into a `C…` smart wallet
by calling the USDC SAC's `mint` as the issuer (signed server-side — no key
reaches the browser):

```
POST /api/dev/fund-wallet { "wallet": "C…", "amountUsdc": "100" }
```

Mounted only when `STELLAR_NETWORK !== 'mainnet'`; requires `PLATFORM_ISSUER_SECRET`
in `.env` (already present). The web app calls this automatically right after a
**newly created** passkey wallet connects (`WalletProvider.connectViaPasskey` →
`api.devFundWallet`), so the demo needs no manual funding step. Reconnecting an
existing wallet does not re-fund.

Verified on testnet: minting 100 USDC to a fresh `C…` address returns a
successful tx hash.

## Testnet verification (manual — needs live infra)

Tasks 8.1–8.4 require a deployed smart-wallet factory (WASM hash), a reachable +
funded relay (Channels API key or Launchtube JWT), a funded `FEE_SOURCE`, and the
app served over HTTPS/localhost. They cannot be run in CI and must be exercised
against testnet before the demo.

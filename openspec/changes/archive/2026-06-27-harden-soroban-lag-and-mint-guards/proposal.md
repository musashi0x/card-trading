## Why

Two confusing failures surfaced while minting a card and then listing it, both
caused by the API turning a recoverable or self-inflicted condition into an
opaque error:

1. **Listing right after minting returns a 500.** `/api/tx/list` pre-flights the
   seller's card balance against **Horizon** (`requireBalance`), then simulates
   the `list` contract call against the **Soroban RPC** (`buildContractTx`).
   Right after a mint+distribute, Horizon already shows the seller's card
   trustline while the Soroban RPC's ledger view still lags, so the pre-flight
   passes but the SAC `transfer` simulation reverts with
   `Error(Contract, #13)` / `"trustline entry is missing for account"`. The
   existing lagging-ledger retry (`isLaggingLedgerError`) only recognizes
   `MissingValue` and `Account not found`, so this *same race* — already
   documented in the code — is not retried and bubbles up as a 500. Retrying the
   identical request a ledger or two later succeeds, confirming it is transient.

2. **Minting while connected as the platform issuer produces an impossible
   transaction.** `/api/cards/mint` builds the asset with `issuer =
   env.platformIssuer`. If the connected wallet *is* that issuer account, the
   issuer has no trustline to its own asset, so the mint flow returns a
   `changeTrust` for the owner to sign — but Stellar forbids a trustline to an
   asset you issue (`CHANGE_TRUST_SELF_NOT_ALLOWED`), so the signed submit fails
   with no actionable message.

Both are timing/configuration conditions, not data corruption. The fix is to make
the API recover from the transient case and reject the impossible case up front,
so neither shows up as a bare 500/failed submit.

## What Changes

- **Broaden lagging-ledger retry to the SAC trustline-lag shape.** Treat the
  Soroban Asset Contract's transient trustline-missing revert
  (`Error(Contract, #13)` / `"trustline entry is missing"`) as a retryable
  lagging-ledger error in `buildContractTx`, alongside the existing
  `MissingValue` / `Account not found` cases, so a `list` issued moments after a
  mint+distribute self-heals instead of 500-ing.
- **Pre-flight the Soroban-side view, or classify a persistent miss as a 400.**
  Because `Error(Contract, #13)` can also mean a genuinely missing trustline (not
  just lag), after exhausting retries the API SHALL surface it as an actionable
  `MISSING_TRUSTLINE`-style 400, not an `INTERNAL` 500.
- **Reject minting to the issuer account.** `/api/cards/mint` (and `distribute`)
  SHALL reject an `owner` equal to `env.platformIssuer` with a clear pre-flight
  error before any on-chain work or trustline build, since the resulting
  `changeTrust` is categorically invalid.

## Capabilities

### Modified Capabilities
- `marketplace-api`: transaction-build pre-flight tolerates the post-mint Soroban
  lag (retry) and converts a persistent SAC trustline miss into an actionable
  client error; card minting rejects the issuer account as owner.

## Impact

- **API** (`apps/api/src/stellar.ts`): `isLaggingLedgerError` (or the
  `buildContractTx` retry path) recognizes the SAC `Error(Contract, #13)` /
  trustline-missing shape; on retry exhaustion the error is mapped to a 400
  `MISSING_TRUSTLINE` rather than an unwrapped 500.
- **API** (`apps/api/src/routes/cards.ts`): `mint` and `distribute` reject
  `owner === env.platformIssuer` with a `PreflightError` (e.g.
  `OWNER_IS_ISSUER`).
- **Tests**: cover the SAC-lag retry/classification and the issuer-as-owner
  rejection.

## Non-Goals

- Reworking the Horizon-vs-Soroban split-view architecture itself.
- Removing the `/list` build's side effect of inserting an `open` listing row on
  every successful build (tracked separately).
- Changing how passkey/smart-wallet (`C…`) minting works — it mints copies
  server-side and is unaffected.

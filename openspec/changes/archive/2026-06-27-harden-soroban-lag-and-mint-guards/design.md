## Context

The marketplace API reads chain state from **two** sources that advance on
slightly different clocks:

- **Horizon** — classic account/trustline/balance state. Used by `requireBalance`,
  `hasTrustline`, `requireTrustline`, `getAssetBalance` (`apps/api/src/stellar.ts`).
- **Soroban RPC** — contract simulation. Used by `buildContractTx`, which calls
  `getAccount` + `prepareTransaction` (simulate) to assemble an unsigned contract
  call.

Right after a card is minted and distributed, Horizon reflects the new card
trustline before the Soroban RPC ingests it. The `/api/tx/list` route exploits
the first and depends on the second:

```
/api/tx/list                                   apps/api/src/routes/tx.ts:98
  requireBalance(seller, card, '1')   ──Horizon──▶  ✓ (ahead)
  buildContractTx(seller, list op)    ──Soroban──▶  simulate transfer
        list → SAC.transfer(seller → marketplace, amount)
              ✗ Error(Contract, #13) "trustline entry is missing"
```

`buildContractTx` already retries this class of race, but only for two error
spellings:

```js
// stellar.ts:54
function isLaggingLedgerError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /MissingValue/.test(msg) || /Account not found/i.test(msg);
}
```

The SAC surfaces the same underlying lag as `Error(Contract, #13)` /
`"trustline entry is missing for account"`, which matches neither pattern, so the
request 500s instead of retrying. An identical request a ledger or two later
returns 200 — confirming it is transient.

Separately, `/api/cards/mint` builds the asset with `issuer = env.platformIssuer`
and, for a classic owner without a trustline, returns a `changeTrust` to sign.
When the connected wallet *is* the issuer, that `changeTrust` is invalid by
protocol (`CHANGE_TRUST_SELF_NOT_ALLOWED`) and the signed submit fails with no
actionable guidance.

## Goals / Non-Goals

**Goals:**
- A `list` issued moments after a mint+distribute self-heals via retry rather
  than returning a 500.
- A genuinely missing seller trustline (not lag) returns an actionable 400, not
  an opaque `INTERNAL` 500.
- Minting to the issuer account fails fast with a clear message before any
  on-chain work or trustline build.

**Non-Goals:**
- Re-architecting the Horizon/Soroban split-view reads.
- Eliminating the `/list` build-time listing insert.
- Touching the passkey/smart-wallet mint path.

## Decisions

### Decision 1: Treat the SAC trustline-lag revert as a retryable lagging-ledger error

Extend `isLaggingLedgerError` (or the `buildContractTx` retry classifier) to also
match the SAC's transient trustline-missing shape — `/trustline entry is missing/i`
and/or the `Error(Contract, #13)` discriminant. The existing bounded retry (5
attempts, 2s apart) then bridges the post-mint window the same way it already does
for `MissingValue`.

**Caveat to resolve in implementation:** `Error(Contract, #13)` from the SAC is
not exclusively "lagging" — it is also how a *genuinely* missing trustline
presents. Matching on the message string is pragmatic but coarse. Before
finalizing, confirm whether `#13` is a stable, single-meaning discriminant for
this SAC (token contract) or overloaded; prefer matching the human-readable
`"trustline entry is missing"` diagnostic if `#13` is ambiguous.

### Decision 2: After retry exhaustion, classify as a 400, not a 500

Because the retried condition can be persistent (the seller really has no
trustline), exhausting the retries SHALL raise a `PreflightError`
(`MISSING_TRUSTLINE`, status 400) with the seller + asset in `details`, instead of
letting the raw `HostError` bubble to the 500 fallback. This makes both outcomes
intelligible to the client: transient → succeeds on retry; persistent → "establish
a trustline first."

Optionally, pre-flight the Soroban-side balance explicitly before simulating, so
the 400 is raised proactively rather than after a full retry cycle. This is the
more robust shape but a larger change; the retry-then-classify path is the minimal
fix.

### Decision 3: Reject `owner === env.platformIssuer` at mint/distribute

In `/api/cards/mint` and `/api/cards/:id/distribute`, reject an `owner` equal to
`env.platformIssuer` with a `PreflightError` (e.g. `OWNER_IS_ISSUER`) before
allocating an asset code, deploying the SAC, or building a trustline. An issuer
cannot hold a trustline to its own asset, so minting "copies to the issuer" is
both impossible to complete (classic path) and semantically meaningless.

## Risks / Trade-offs

- **Over-broad retry:** matching `"trustline entry is missing"` could retry a
  genuinely missing trustline 5× before the 400. Acceptable — bounded latency,
  and the outcome is still a clean 400. Decision 2 contains the blast radius.
- **String-matching fragility:** SAC error text/codes can change across protocol
  or SDK versions. Mitigate by matching on the stable diagnostic phrase and
  documenting the assumption next to `isLaggingLedgerError`.

## Open Questions

- Is `Error(Contract, #13)` a stable single-meaning code for the card SAC, or
  should we match only the `"trustline entry is missing"` diagnostic string?
- Should we add the proactive Soroban-side balance pre-flight now (Decision 2,
  optional), or defer it and ship retry-then-classify only?

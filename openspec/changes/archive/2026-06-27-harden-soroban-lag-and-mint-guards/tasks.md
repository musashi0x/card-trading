## 1. Soroban lag retry & classification

- [x] 1.1 Extend `isLaggingLedgerError` (`apps/api/src/stellar.ts`) to match the SAC trustline-lag shape — `/trustline entry is missing/i` and/or the `Error(Contract, #13)` discriminant — with a comment documenting the assumption
- [x] 1.2 Confirm whether `Error(Contract, #13)` is a stable single-meaning code for the card SAC; if ambiguous, match only the `"trustline entry is missing"` diagnostic — **resolved: matched the `"trustline entry is missing"` diagnostic only; `#13` is overloaded (the marketplace contract re-raises it on escalation)**
- [x] 1.3 After the `buildContractTx` retry loop is exhausted on this shape, raise a `PreflightError('…establish a trustline…', 'MISSING_TRUSTLINE', { account, asset })` (status 400) instead of letting the `HostError` bubble to the 500 fallback — *(details carry `account`; the asset isn't in `buildContractTx`'s scope)*
- [ ] 1.4 (Optional, Decision 2) Add a proactive Soroban-side seller balance pre-flight in `/api/tx/list` so a persistent miss returns 400 without a full retry cycle — **deferred, pending decision**

## 2. Mint/distribute issuer guard

- [x] 2.1 In `/api/cards/mint`, reject `owner === env.platformIssuer` with `PreflightError('Cannot mint to the issuer account', 'OWNER_IS_ISSUER')` before allocating an asset code or deploying the SAC
- [x] 2.2 Apply the same guard in `/api/cards/:id/distribute`

## 3. Tests — DEFERRED (no JS/TS test harness exists in the monorepo)

> The repo has no vitest/jest setup or `test` script (only the Rust contract uses
> `cargo test`). Standing up a harness is out of scope for this change; revisit as
> a dedicated testing-infrastructure effort. Behavior was verified via typecheck
> and the live repro in the originating session.

- [ ] 3.1 Test: a `list` build whose simulation throws the SAC trustline-lag error is retried and succeeds once the (mocked) Soroban view catches up — **deferred**
- [ ] 3.2 Test: a persistent SAC trustline miss returns a 400 `MISSING_TRUSTLINE`, not a 500 `INTERNAL` — **deferred**
- [ ] 3.3 Test: `mint` and `distribute` reject `owner === platformIssuer` with `OWNER_IS_ISSUER` — **deferred**
- [ ] 3.4 Run the API test suite — existing + new tests pass — **deferred**

## 4. Docs

- [x] 4.1 Note the Horizon-vs-Soroban split-view caveat and the issuer-cannot-mint rule near the relevant handlers / README troubleshooting

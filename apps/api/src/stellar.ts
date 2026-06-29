/**
 * Stellar service layer for the API.
 *
 * Builds + simulates contract-invocation transactions (returns unsigned XDR for
 * the wallet), submits wallet-signed XDR, parses return values, and runs the
 * Horizon-based pre-flight checks (trustline / balance) before asking a user to
 * sign. The API never holds a private key.
 */

import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type xdr,
} from '@stellar/stellar-sdk';
import { MarketplaceContract } from '@cardmkt/shared';
import { env } from './env.js';
import { getLog } from './context.js';

export const rpcServer = new rpc.Server(env.stellar.rpcUrl, {
  allowHttp: env.stellar.rpcUrl.startsWith('http://'),
});
export const horizon = new Horizon.Server(env.stellar.horizonUrl);

export class PreflightError extends Error {
  status = 400;
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * A just-minted card's `list` simulates a SAC `transfer` from the seller, which
 * reverts while the Soroban RPC's ledger view still lags Horizon — its
 * diagnostic reads "trustline entry is missing for account". We match that
 * human-readable phrase rather than the accompanying `Error(Contract, #13)`
 * code, because that code is overloaded: the marketplace contract re-raises the
 * same `#13` as it escalates the trap, and any contract may define its own
 * `#13`, so keying on the code would over-match unrelated failures.
 */
function isTrustlineMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /trustline entry is missing/i.test(msg);
}

/**
 * A contract call that depends on state written by a just-submitted classic tx
 * can transiently fail because the soroban RPC's ledger view briefly lags
 * Horizon. Three shapes show up right after minting + distributing a card,
 * before its `list`:
 *  - `Account not found` from `getAccount` — the freshly funded seller isn't
 *    indexed by the RPC yet (Horizon already reports it).
 *  - `Storage, MissingValue` from simulation — the seller's just-minted card
 *    balance isn't visible yet when `list` simulates its transfer.
 *  - "trustline entry is missing" from the SAC `transfer` — the seller's
 *    just-distributed card trustline isn't ingested by the RPC yet, even though
 *    `requireBalance` already sees it on Horizon.
 * All clear within a ledger or two, so they're worth a short retry, not a 500.
 */
function isLaggingLedgerError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /MissingValue/.test(msg) || /Account not found/i.test(msg) || isTrustlineMissingError(err)
  );
}

/**
 * Resolve the source account (and thus the sequence number) a contract build
 * should use. Contract (C…) sources only exist on the RPC, so they read from it
 * directly. For a classic (G…) source the authoritative sequence lives on
 * Horizon: a user's classic tx — most notably the one-time trustline a seller
 * signs right before `create_auction` — is submitted through Horizon, which
 * reflects the consumed sequence before the Soroban RPC's account view catches
 * up (the same lag as {@link isLaggingLedgerError} / {@link waitForRpcSequence}).
 * Reading the source straight from the RPC there can pick up the already-consumed
 * sequence and be rejected on submit with txBadSeq. So wait for the RPC to catch
 * up to Horizon, and if it never does, build on Horizon's (newer) sequence.
 *
 * Issuer Soroban ops run the other way round — they're submitted via the RPC, so
 * the RPC is the one that's ahead. There the `>= horizonSeq` check passes on the
 * first poll and the RPC account is returned unchanged, so this is a no-op for
 * the issuer flow.
 */
async function loadBuildSource(source: string) {
  if (isContractAddress(source)) return rpcServer.getAccount(source);
  let horizonAccount;
  try {
    horizonAccount = await horizon.loadAccount(source);
  } catch {
    // Not indexed by Horizon yet; the RPC is all we have to build on.
    return rpcServer.getAccount(source);
  }
  const horizonSeq = BigInt(horizonAccount.sequenceNumber());
  for (let i = 0; i < 20; i++) {
    try {
      const account = await rpcServer.getAccount(source);
      if (BigInt(account.sequenceNumber()) >= horizonSeq) return account;
    } catch {
      // RPC may not have indexed the account yet; keep polling until it does.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return horizonAccount;
}

/** Build, simulate, and assemble a contract-call tx; return unsigned XDR. */
export async function buildContractTx(source: string, operation: xdr.Operation): Promise<string> {
  // Retry on a lagging-ledger error so the RPC can catch up to the state Horizon
  // already reports (see isLaggingLedgerError). Each attempt refetches the
  // account for a current sequence number.
  for (let attempt = 0; ; attempt++) {
    try {
      const account = await loadBuildSource(source);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: env.stellar.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(180)
        .build();

      const prepared = await rpcServer.prepareTransaction(tx);
      return prepared.toXDR();
    } catch (err) {
      if (attempt < 5 && isLaggingLedgerError(err)) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      // A trustline-missing revert that outlives the retry window is no longer a
      // transient lag — the source genuinely can't move the asset. Surface it as
      // an actionable 400 rather than letting the raw HostError become a 500.
      if (isTrustlineMissingError(err)) {
        throw new PreflightError(
          'Account must establish a trustline to the card asset before this action',
          'MISSING_TRUSTLINE',
          { account: source },
        );
      }
      throw err;
    }
  }
}

export interface SubmitResult {
  hash: string;
  successful: boolean;
  returnValue: unknown;
}

/**
 * Transaction-level result codes the API turns into a specific, actionable error
 * instead of an opaque SUBMIT_FAILED. The dominant one is `txTooLate`: a signed
 * XDR is only valid until its `maxTime` (we build with `.setTimeout(180)`), so
 * once more than ~3 minutes pass between build → sign → submit — a slow wallet
 * prompt, a resubmitted stale request, or a server clock running behind the
 * network — the ledger rejects it as expired. The fix is always the same: build
 * and sign a fresh transaction, so the message says exactly that.
 */
const TX_RESULT_ERRORS: Record<string, { code: string; message: string }> = {
  txTooLate: {
    code: 'TX_EXPIRED',
    message:
      'This transaction expired before it reached the network. Please sign and submit a fresh transaction.',
  },
  txTooEarly: {
    code: 'TX_NOT_YET_VALID',
    message: 'This transaction is not valid yet. Please try again in a moment.',
  },
  txBadSeq: {
    code: 'TX_BAD_SEQUENCE',
    message: 'This transaction used a stale account sequence. Please try again.',
  },
  txInsufficientFee: {
    code: 'INSUFFICIENT_FEE',
    message: 'The network fee was too low to include this transaction. Please try again.',
  },
  txInsufficientBalance: {
    code: 'INSUFFICIENT_BALANCE',
    message: 'The account balance is too low to cover this transaction.',
  },
  txBadAuth: {
    code: 'BAD_AUTH',
    message:
      'The transaction signature was not accepted. Please reconnect your wallet and try again.',
  },
  txNoAccount: {
    code: 'ACCOUNT_NOT_FOUND',
    message: 'The source account does not exist on the network.',
  },
};

/**
 * Pull the transaction-level result code name (e.g. `txTooLate`) out of a failed
 * submission. Tries the typed XDR accessor first, then the raw js-xdr
 * `_attributes` shape a deserialized error carries, so an SDK structure change
 * degrades to "unknown" rather than throwing inside the error path.
 */
function txResultCode(errorResult: unknown): string | undefined {
  if (!errorResult) return undefined;
  try {
    const typed = errorResult as { result?: () => { switch?: () => { name?: string } } };
    const name = typed.result?.().switch?.().name;
    if (typeof name === 'string') return name;
  } catch {
    // fall through to the raw shape
  }
  const raw = (errorResult as { _attributes?: { result?: { _switch?: { name?: string } } } })
    ?._attributes?.result?._switch?.name;
  return typeof raw === 'string' ? raw : undefined;
}

/** Horizon reports the same codes in snake_case (`tx_too_late`); normalize to camelCase. */
function horizonResultCode(err: unknown): string | undefined {
  const tx = (
    err as {
      response?: { data?: { extras?: { result_codes?: { transaction?: string } } } };
    }
  )?.response?.data?.extras?.result_codes?.transaction;
  return tx ? tx.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()) : undefined;
}

/** Map a failed submission's result code to a specific, client-actionable error. */
function submitFailure(codeName: string | undefined, details?: Record<string, unknown>): PreflightError {
  const known = codeName ? TX_RESULT_ERRORS[codeName] : undefined;
  if (known) {
    return new PreflightError(known.message, known.code, { resultCode: codeName, ...details });
  }
  return new PreflightError(
    codeName ? `Transaction submission failed (${codeName})` : 'Transaction submission failed',
    'SUBMIT_FAILED',
    { resultCode: codeName, ...details },
  );
}

/** Submit a wallet-signed XDR and wait for the result, returning the parsed return value. */
export async function submitSignedTx(signedXdr: string): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, env.stellar.networkPassphrase);
  const sent = await rpcServer.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw submitFailure(txResultCode(sent.errorResult), { errorResult: sent.errorResult });
  }

  // Poll until the transaction settles.
  let result = await rpcServer.getTransaction(sent.hash);
  for (let i = 0; i < 30 && result.status === 'NOT_FOUND'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await rpcServer.getTransaction(sent.hash);
  }

  const successful = result.status === 'SUCCESS';
  let returnValue: unknown = null;
  if (successful && 'returnValue' in result && result.returnValue) {
    try {
      returnValue = scValToNative(result.returnValue);
    } catch {
      returnValue = null;
    }
  }
  return { hash: sent.hash, successful, returnValue };
}

/** The platform issuer's current sequence number, as the soroban RPC sees it. */
async function issuerSequence(): Promise<bigint> {
  const account = await rpcServer.getAccount(env.platformIssuer);
  return BigInt(account.sequenceNumber());
}

/** A bad-sequence rejection — duplicate/stale sequence; retryable once re-synced. */
function isBadSeqError(err: unknown): boolean {
  const errorResult = (err as { details?: { errorResult?: unknown } })?.details?.errorResult;
  if (txResultCode(errorResult) === 'txBadSeq') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /txBadSeq|tx_bad_seq|bad sequence/i.test(msg);
}

/**
 * Run an issuer-sourced operation with sequence safety. Every server-side issuer
 * op (SAC deploy, royalty registration, card/USDC mint) sources from the same
 * account, so without coordination overlapping ops fetch the same sequence and
 * all but one fail on-chain with tx_bad_seq (surfaced as SUBMIT_FAILED /
 * SAC_DEPLOY_FAILED / ROYALTY_FAILED / MINT_FAILED). Two safeguards:
 *  1. After each op, poll until the RPC reflects the consumed sequence, so the
 *     next op builds on a fresh one rather than a stale duplicate.
 *  2. Retry on a bad-sequence rejection, since load-balanced RPC nodes can still
 *     briefly disagree on the latest sequence; re-fetching clears it.
 */
async function runIssuerOp<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const before = await issuerSequence();
    try {
      const result = await fn();
      for (let i = 0; i < 20 && (await issuerSequence()) <= before; i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
      return result;
    } catch (err) {
      if (attempt >= 4 || !isBadSeqError(err)) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Serializes issuer-sourced operations so their sequence handling can't interleave. */
let issuerTxQueue: Promise<unknown> = Promise.resolve();
function withIssuerLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = issuerTxQueue.then(() => runIssuerOp(fn));
  // Keep the chain alive regardless of any single op's outcome.
  issuerTxQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Fetch a settled transaction's parsed return value by hash. Used by the passkey
 * relay path, where the relayer (not the API) submitted the tx, so we recover
 * the contract's return value (e.g. a new offer id) from the on-chain result.
 */
export async function transactionReturnValue(hash: string): Promise<unknown> {
  let result = await rpcServer.getTransaction(hash);
  for (let i = 0; i < 30 && result.status === 'NOT_FOUND'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await rpcServer.getTransaction(hash);
  }
  if (result.status === 'SUCCESS' && 'returnValue' in result && result.returnValue) {
    try {
      return scValToNative(result.returnValue);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Single-shot recovery of a settled transaction's numeric return value — the id
 * of a created listing/offer/order/auction — for the indexer's id-backfill of
 * rows whose original parse came back null (a transient miss when the submit path
 * read the result before its meta was fully available). No polling: the tx
 * already settled (we hold its hash), so a still-`NOT_FOUND` or unparsable result
 * simply yields `null` and is retried on the next reconcile pass.
 */
export async function transactionCreatedId(hash: string): Promise<number | null> {
  const result = await rpcServer.getTransaction(hash);
  if (result.status === 'SUCCESS' && 'returnValue' in result && result.returnValue) {
    try {
      const id = Number(scValToNative(result.returnValue));
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Build an unsigned classic `changeTrust` tx so `account` trusts `asset`. */
export async function buildChangeTrustTx(account: string, asset: Asset): Promise<string> {
  const source = await horizon.loadAccount(account);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: env.stellar.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(180)
    .build();
  return tx.toXDR();
}

/** Build an unsigned `changeTrust` tx so a user can trust a card asset. */
export const buildTrustlineTx = buildChangeTrustTx;

/**
 * The cheapest source-asset → USDC route Horizon can find for an exact USDC
 * receive amount. Returns the estimated source spend and the intermediate path,
 * or `null` when no route exists (the caller surfaces `NO_PATH`).
 */
export async function findStrictReceivePath(
  sourceAsset: Asset,
  destAsset: Asset,
  destAmount: string,
): Promise<{ sendAmount: string; path: Asset[] } | null> {
  const { records } = await horizon
    .strictReceivePaths([sourceAsset], destAsset, destAmount)
    .call();
  if (!records.length) return null;
  // Records arrive cheapest-first, but sort defensively on the source spend.
  const best = records.reduce((a, b) =>
    Number(a.source_amount) <= Number(b.source_amount) ? a : b,
  );
  const path = best.path.map((p) =>
    p.asset_type === 'native'
      ? Asset.native()
      : new Asset(p.asset_code as string, p.asset_issuer as string),
  );
  return { sendAmount: best.source_amount, path };
}

/** `sendMax` = `sourceAmount` padded by `slippageBps`, to stroop precision. */
export function withSlippage(sourceAmount: string, slippageBps: number): string {
  const padded = Number(sourceAmount) * (1 + slippageBps / 10_000);
  return padded.toFixed(7);
}

/**
 * Build an unsigned `PathPaymentStrictReceive` that converts `sourceAsset` into
 * exactly `destAmount` of `destAsset` delivered to the buyer's own account,
 * spending at most `sendMax`. The settlement step then spends that USDC.
 */
export async function buildPathPaymentTx(
  buyer: string,
  sourceAsset: Asset,
  sendMax: string,
  destAsset: Asset,
  destAmount: string,
  path: Asset[],
): Promise<string> {
  const source = await horizon.loadAccount(buyer);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: env.stellar.networkPassphrase,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: sourceAsset,
        sendMax,
        destination: buyer,
        destAsset,
        destAmount,
        path,
      }),
    )
    .setTimeout(180)
    .build();
  return tx.toXDR();
}

/**
 * After Horizon accepts a classic tx, the Soroban RPC's account view can still
 * report the pre-tx sequence for a ledger or two — the same lag documented in
 * {@link isLaggingLedgerError}. Any contract build that follows reads its source
 * sequence from the RPC (`buildContractTx` → `getAccount`), so a `buy_now` built
 * right after a pay-with-asset conversion — or any build after a trustline — can
 * pick up the already-consumed sequence and be rejected on submit with txBadSeq.
 * Poll until the RPC reflects the consumed sequence so the next build is fresh.
 */
async function waitForRpcSequence(source: string, consumedSeq: bigint): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const account = await rpcServer.getAccount(source);
      if (BigInt(account.sequenceNumber()) >= consumedSeq) return;
    } catch {
      // RPC may not have indexed the account yet; keep polling until it does.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Submit a wallet-signed classic tx via Horizon (used for trustlines). */
export async function submitClassicTx(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, env.stellar.networkPassphrase);
  try {
    const res = await horizon.submitTransaction(tx);
    // Don't return until the RPC reflects this tx's consumed sequence, so a
    // follow-on contract build (conversion → buy_now, trustline → settle) reads
    // a fresh sequence instead of being rejected later with txBadSeq.
    if ('sequence' in tx) {
      await waitForRpcSequence(tx.source, BigInt(tx.sequence));
    }
    return res.hash;
  } catch (err) {
    // Classic trustline txs carry the same 180s window, so an expired or
    // otherwise-rejected submission gets the same actionable error as the
    // Soroban path rather than leaking a raw Horizon 400.
    const codeName = horizonResultCode(err);
    if (codeName && TX_RESULT_ERRORS[codeName]) throw submitFailure(codeName);
    throw err;
  }
}

interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

async function balances(account: string): Promise<HorizonBalance[]> {
  try {
    const acct = await horizon.loadAccount(account);
    return acct.balances as HorizonBalance[];
  } catch {
    throw new PreflightError('Account not found or not funded', 'ACCOUNT_NOT_FOUND', { account });
  }
}

function findBalance(list: HorizonBalance[], asset: Asset): HorizonBalance | undefined {
  if (asset.isNative()) return list.find((b) => b.asset_type === 'native');
  return list.find((b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer());
}

/** The account's balance of `asset` as a decimal string (`"0"` if untrusted/absent). */
export async function getAssetBalance(account: string, asset: Asset): Promise<string> {
  const bal = findBalance(await balances(account), asset);
  return bal?.balance ?? '0';
}

/** Get both XLM and USDC balances and trustline status for an account (classic or contract). */
export async function getAccountBalances(account: string): Promise<{ usdc: string; xlm: string; usdcTrustline: boolean }> {
  const usdcAsset = new Asset(env.usdc.code, env.usdc.issuer);
  let usdc = '0';
  let xlm = '0';
  let usdcTrustline = false;

  if (isContractAddress(account)) {
    // Contract accounts are funded via smart contracts directly, they don't need a classic trustline.
    usdcTrustline = true;
    try {
      const stroops = await smartWalletUsdcStroops(account);
      if (stroops != null) {
        usdc = (Number(stroops) / 10_000_000).toFixed(7);
      }
    } catch (err) {
      // Contract might not exist or be deployed yet
    }
  } else {
    try {
      const list = await balances(account);
      const usdcBal = findBalance(list, usdcAsset);
      if (usdcBal) {
        usdc = usdcBal.balance;
        usdcTrustline = true;
      }
      const xlmBal = findBalance(list, Asset.native());
      if (xlmBal) {
        xlm = xlmBal.balance;
      }
    } catch {
      // Account doesn't exist on-chain or not funded
    }
  }

  return { usdc, xlm, usdcTrustline };
}

/**
 * The ISO timestamp of when a classic account was created on-chain, read from
 * its first Horizon operation (the `create_account`). Returns `null` for
 * contract (`C…`) accounts — whose creation isn't a classic operation — or when
 * the account/operation can't be resolved, so callers can fall back to their own
 * timestamp.
 */
export async function accountCreatedAt(account: string): Promise<string | null> {
  if (isContractAddress(account)) return null;
  try {
    const ops = await horizon.operations().forAccount(account).order('asc').limit(1).call();
    return ops.records[0]?.created_at ?? null;
  } catch {
    return null;
  }
}


/**
 * Filter `cards` down to those `account` actually holds on-chain. "Holding" a
 * card means a positive token balance, read differently per account kind:
 *  - classic (`G…`): a single Horizon lookup lists every trustline; we keep
 *    cards whose asset (code + issuer) shows a balance > 0.
 *  - smart wallet (`C…`): card tokens live inside the SAC, invisible to Horizon,
 *    so each deployed card's `balance(addr)` is simulated via the RPC.
 * An unfunded / unknown account holds nothing.
 */
export async function filterHeldCards<
  T extends { assetCode: string; issuer: string; sacAddress: string | null },
>(account: string, cards: T[]): Promise<T[]> {
  if (isContractAddress(account)) {
    const held = await Promise.all(
      cards.map(async (c) => {
        if (!c.sacAddress) return false;
        const stroops = await smartWalletTokenStroops(c.sacAddress, account);
        return stroops != null && stroops > 0n;
      }),
    );
    return cards.filter((_, i) => held[i]);
  }
  let list: HorizonBalance[];
  try {
    list = await balances(account);
  } catch {
    return []; // unfunded / unknown account holds nothing
  }
  const held = new Set(
    list
      .filter((b) => b.asset_code && b.asset_issuer && Number(b.balance) > 0)
      .map((b) => `${b.asset_code}:${b.asset_issuer}`),
  );
  return cards.filter((c) => held.has(`${c.assetCode}:${c.issuer}`));
}

/** Whether `account` already trusts `asset` (no throw). */
export async function hasTrustline(account: string, asset: Asset): Promise<boolean> {
  return Boolean(findBalance(await balances(account), asset));
}

/** Ensure `account` trusts `asset`; throw an actionable error if not. */
export async function requireTrustline(account: string, asset: Asset): Promise<void> {
  const list = await balances(account);
  if (!findBalance(list, asset)) {
    throw new PreflightError(
      `Account must establish a trustline to ${asset.getCode()} before this action`,
      'MISSING_TRUSTLINE',
      { assetCode: asset.getCode(), assetIssuer: asset.getIssuer() },
    );
  }
}

/** Ensure `account` holds at least `amount` of `asset`. */
export async function requireBalance(account: string, asset: Asset, amount: string): Promise<void> {
  const list = await balances(account);
  const bal = findBalance(list, asset);
  if (!bal) {
    throw new PreflightError(
      `Account must establish a trustline to ${asset.getCode()} first`,
      'MISSING_TRUSTLINE',
      { assetCode: asset.getCode(), assetIssuer: asset.getIssuer() },
    );
  }
  if (Number(bal.balance) < Number(amount)) {
    throw new PreflightError(
      `Insufficient ${asset.getCode()} balance: have ${bal.balance}, need ${amount}`,
      'INSUFFICIENT_BALANCE',
      { have: bal.balance, need: amount, assetCode: asset.getCode() },
    );
  }
}

/**
 * Ensure the buyer holds at least `amount` of the asset they want to spend on a
 * conversion. Unlike {@link requireBalance}, *not holding the asset at all* is
 * reported as `INSUFFICIENT_BALANCE` (the buyer simply can't pay with it),
 * never as a trustline prompt.
 */
export async function requireSourceBalance(
  account: string,
  asset: Asset,
  amount: string,
): Promise<void> {
  const list = await balances(account);
  const bal = findBalance(list, asset);
  const have = bal?.balance ?? '0';
  if (Number(have) < Number(amount)) {
    throw new PreflightError(
      `Insufficient ${asset.getCode()} balance: have ${have}, need ${amount}`,
      'INSUFFICIENT_BALANCE',
      { have, need: amount, assetCode: asset.getCode() },
    );
  }
}

// --- dev helper: mint test USDC to a smart wallet ---

/**
 * Mint test USDC straight into a contract account (`C…`) by calling the USDC
 * Stellar Asset Contract's `mint` as the issuer (the SAC admin). Classic
 * payments can't target a contract address, so the demo funds smart wallets
 * this way. Testnet/dev only — gated by the caller.
 */
export async function mintUsdcTo(
  recipient: string,
  amountStroops: bigint,
  issuerSecret: string,
): Promise<SubmitResult> {
  return withIssuerLock(async () => {
    const usdc = new Asset(env.usdc.code, env.usdc.issuer);
    const sac = new Contract(usdc.contractId(env.stellar.networkPassphrase));
    const op = sac.call(
      'mint',
      new Address(recipient).toScVal(),
      nativeToScVal(amountStroops, { type: 'i128' }),
    );
    const unsignedXdr = await buildContractTx(env.usdc.issuer, op);
    const tx = TransactionBuilder.fromXDR(unsignedXdr, env.stellar.networkPassphrase);
    tx.sign(Keypair.fromSecret(issuerSecret));
    return submitSignedTx(tx.toXDR());
  });
}

/**
 * Build, sign (with `secret`), and submit a contract-call sourced from that
 * key's own account. Used for server-held keys that act in their own right — e.g.
 * the arbiter resolving a disputed escrow order. Unlike {@link withIssuerLock}
 * helpers, the source is the signer itself, not the platform issuer.
 */
export async function signAndSubmitAs(
  secret: string,
  operation: xdr.Operation,
): Promise<SubmitResult> {
  const kp = Keypair.fromSecret(secret);
  const unsignedXdr = await buildContractTx(kp.publicKey(), operation);
  const tx = TransactionBuilder.fromXDR(unsignedXdr, env.stellar.networkPassphrase);
  tx.sign(kp);
  return submitSignedTx(tx.toXDR());
}

// --- card minting (issue a new card asset at runtime) ---

/** One card copy in stroops — assets carry 7 decimals, so 1 copy = 1.0 unit. */
const ONE_CARD = 10_000_000n;

/** Whether an address is a Soroban contract account (`C…`) vs. a classic `G…`. */
export function isContractAddress(address: string): boolean {
  return address.startsWith('C');
}

/**
 * Deploy the Stellar Asset Contract for a freshly issued card asset, signed by
 * the platform issuer. Returns the deterministic SAC address. Idempotent at the
 * address level: the SAC id derives from the asset, so a re-deploy of the same
 * asset would fail on-chain — callers mint with a fresh (random) asset code.
 */
export async function deployCardSac(asset: Asset, issuerSecret: string): Promise<string> {
  return withIssuerLock(async () => {
    const op = Operation.createStellarAssetContract({ asset });
    const unsignedXdr = await buildContractTx(env.platformIssuer, op);
    const tx = TransactionBuilder.fromXDR(unsignedXdr, env.stellar.networkPassphrase);
    tx.sign(Keypair.fromSecret(issuerSecret));
    const result = await submitSignedTx(tx.toXDR());
    if (!result.successful) {
      throw new PreflightError('Card SAC deployment did not succeed on-chain', 'SAC_DEPLOY_FAILED', {
        hash: result.hash,
      });
    }
    return asset.contractId(env.stellar.networkPassphrase);
  });
}

/**
 * Distribute `copies` of a card to `owner`, signed by the platform issuer.
 *  - Smart wallet (`C…`): SAC `mint(owner, amount)` — gasless, no trustline.
 *  - Classic (`G…`): a classic issuer `payment` — requires `owner` to already
 *    trust the asset (enforced by the caller before this runs).
 * Returns the settlement tx hash.
 */
export async function mintCardCopies(
  asset: Asset,
  sacAddress: string,
  owner: string,
  copies: number,
  issuerSecret: string,
): Promise<string> {
  return withIssuerLock(async () => {
    if (isContractAddress(owner)) {
      const sac = new Contract(sacAddress);
      const op = sac.call(
        'mint',
        new Address(owner).toScVal(),
        nativeToScVal(BigInt(copies) * ONE_CARD, { type: 'i128' }),
      );
      const unsignedXdr = await buildContractTx(env.platformIssuer, op);
      const tx = TransactionBuilder.fromXDR(unsignedXdr, env.stellar.networkPassphrase);
      tx.sign(Keypair.fromSecret(issuerSecret));
      const result = await submitSignedTx(tx.toXDR());
      if (!result.successful) {
        throw new PreflightError('Card mint did not succeed on-chain', 'MINT_FAILED', {
          hash: result.hash,
        });
      }
      return result.hash;
    }
    // Classic owner: standard issuer payment over Horizon.
    const issuer = await horizon.loadAccount(env.platformIssuer);
    const tx = new TransactionBuilder(issuer, {
      fee: BASE_FEE,
      networkPassphrase: env.stellar.networkPassphrase,
    })
      .addOperation(Operation.payment({ destination: owner, asset, amount: String(copies) }))
      .setTimeout(180)
      .build();
    tx.sign(Keypair.fromSecret(issuerSecret));
    const res = await horizon.submitTransaction(tx);
    return res.hash;
  });
}

/**
 * Register a creator royalty for a newly minted card on the settlement contract,
 * signed by the contract admin (the platform). Mirrors the deploy script's
 * `set_royalty`; rejected on-chain if `royaltyBps` exceeds the configured cap.
 */
export async function setCardRoyalty(
  sacAddress: string,
  creator: string,
  royaltyBps: number,
  adminSecret: string,
): Promise<string> {
  return withIssuerLock(async () => {
    const op = new MarketplaceContract(env.contractId).setRoyalty(sacAddress, creator, royaltyBps);
    const unsignedXdr = await buildContractTx(env.platformIssuer, op);
    const tx = TransactionBuilder.fromXDR(unsignedXdr, env.stellar.networkPassphrase);
    tx.sign(Keypair.fromSecret(adminSecret));
    const result = await submitSignedTx(tx.toXDR());
    if (!result.successful) {
      throw new PreflightError('Royalty registration did not succeed on-chain', 'ROYALTY_FAILED', {
        hash: result.hash,
      });
    }
    return result.hash;
  });
}

// --- passkey smart-wallet (contract-account) pre-flight ---

/**
 * A smart wallet (`C…`) holds USDC inside the token's Stellar Asset Contract,
 * not as a classic trustline, so its balance is read by simulating the USDC
 * SAC's `balance(addr)` rather than via Horizon. Returns stroops, or `null` when
 * the balance can't be determined (e.g. the wallet/SAC entry doesn't exist yet).
 */
export async function smartWalletUsdcStroops(walletContractId: string): Promise<bigint | null> {
  const usdc = new Asset(env.usdc.code, env.usdc.issuer);
  return smartWalletTokenStroops(usdc.contractId(env.stellar.networkPassphrase), walletContractId);
}

/**
 * Read a smart wallet's (`C…`) balance of any token by simulating the token
 * contract's `balance(addr)`. Returns stroops, or `null` when the balance can't
 * be determined (e.g. the wallet/token entry doesn't exist yet).
 */
async function smartWalletTokenStroops(
  tokenContractId: string,
  walletContractId: string,
): Promise<bigint | null> {
  try {
    const sac = new Contract(tokenContractId);
    const op = sac.call('balance', new Address(walletContractId).toScVal());
    const account = await rpcServer.getAccount(env.platformIssuer);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: env.stellar.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    const sim = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
      return BigInt(scValToNative(sim.result.retval) as bigint | number | string);
    }
  } catch {
    // Best-effort: fall through to `null` so an undeployed/unseen wallet does
    // not hard-fail pre-flight (deploy-on-first-use).
  }
  return null;
}

/**
 * The outcome of a read-only contract view simulation (e.g. `get_listing_view`),
 * separating the cases a drifted Postgres mirror can otherwise hide:
 *  - `ok`      → the view returned; `value` is the decoded struct.
 *  - `missing` → the contract reverted during simulation (e.g. `NotFound`): the
 *                entry does not exist on this deployment, so the mirror has
 *                drifted (a stale id from a prior deploy, or an archived entry).
 *  - `unknown` → the RPC was unreachable/unexpected; callers should tolerate this
 *                rather than block a valid action on a transient error.
 */
export type ViewRead =
  | { kind: 'ok'; value: Record<string, unknown> }
  | { kind: 'missing' }
  | { kind: 'unknown' };

/**
 * Simulate a read-only contract view and classify the result. Unlike the
 * indexer's best-effort reader, this distinguishes a definitive on-chain
 * "missing" (the contract panicked) from an unverifiable RPC failure, so a build
 * pre-flight can safely reject a doomed action without false-failing on a hiccup.
 */
export async function simulateContractView(op: xdr.Operation): Promise<ViewRead> {
  try {
    const account = await rpcServer.getAccount(env.platformIssuer);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: env.stellar.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    const sim = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      return { kind: 'missing' };
    }
    if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
      return { kind: 'ok', value: scValToNative(sim.result.retval) as Record<string, unknown> };
    }
  } catch {
    // RPC unreachable / unexpected — unverifiable; let the chain be the backstop.
  }
  return { kind: 'unknown' };
}

/**
 * Ensure a smart-wallet buyer (`C…`) holds enough USDC for `amount`. Skips the
 * classic `G…` trustline check entirely, and — per deploy-on-first-use — does
 * not reject solely because the wallet is undeployed: if the balance can't be
 * read it is treated as unverifiable rather than insufficient.
 */
export async function requireSmartWalletUsdc(
  walletContractId: string,
  amount: string,
): Promise<void> {
  const have = await smartWalletUsdcStroops(walletContractId);
  if (have === null) {
    getLog().warn(
      { walletContractId },
      'preflight: could not read USDC balance for smart wallet; skipping funding check',
    );
    return;
  }
  const need = BigInt(Math.round(Number(amount) * 1e7));
  if (have < need) {
    throw new PreflightError(
      `Insufficient USDC in smart wallet: have ${have} stroops, need ${need}`,
      'INSUFFICIENT_BALANCE',
      { have: have.toString(), need: need.toString() },
    );
  }
}

/**
 * Ensure a smart-wallet seller (`C…`) holds at least one copy of a card token
 * before listing it. Mirrors {@link requireSmartWalletUsdc}: tolerant of an
 * unreadable balance (treated as unverifiable, not a hard fail) so an undeployed
 * wallet's deploy-on-first-use isn't blocked; the on-chain `list` still enforces
 * ownership atomically.
 */
export async function requireSmartWalletCard(
  walletContractId: string,
  cardSacAddress: string,
): Promise<void> {
  const have = await smartWalletTokenStroops(cardSacAddress, walletContractId);
  if (have === null) {
    getLog().warn(
      { walletContractId },
      'preflight: could not read card balance for smart wallet; skipping ownership check',
    );
    return;
  }
  if (have <= 0n) {
    throw new PreflightError(
      'Smart wallet does not hold a copy of this card',
      'INSUFFICIENT_BALANCE',
      { have: have.toString(), need: '10000000' },
    );
  }
}

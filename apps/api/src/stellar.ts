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
import { env } from './env.js';

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

/** Build, simulate, and assemble a contract-call tx; return unsigned XDR. */
export async function buildContractTx(source: string, operation: xdr.Operation): Promise<string> {
  const account = await rpcServer.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: env.stellar.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build();

  const prepared = await rpcServer.prepareTransaction(tx);
  return prepared.toXDR();
}

export interface SubmitResult {
  hash: string;
  successful: boolean;
  returnValue: unknown;
}

/** Submit a wallet-signed XDR and wait for the result, returning the parsed return value. */
export async function submitSignedTx(signedXdr: string): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, env.stellar.networkPassphrase);
  const sent = await rpcServer.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw new PreflightError('Transaction submission failed', 'SUBMIT_FAILED', {
      errorResult: sent.errorResult,
    });
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

/** Submit a wallet-signed classic tx via Horizon (used for trustlines). */
export async function submitClassicTx(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, env.stellar.networkPassphrase);
  const res = await horizon.submitTransaction(tx);
  return res.hash;
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
}

// --- passkey smart-wallet (contract-account) pre-flight ---

/**
 * A smart wallet (`C…`) holds USDC inside the token's Stellar Asset Contract,
 * not as a classic trustline, so its balance is read by simulating the USDC
 * SAC's `balance(addr)` rather than via Horizon. Returns stroops, or `null` when
 * the balance can't be determined (e.g. the wallet/SAC entry doesn't exist yet).
 */
export async function smartWalletUsdcStroops(walletContractId: string): Promise<bigint | null> {
  try {
    const usdc = new Asset(env.usdc.code, env.usdc.issuer);
    const sac = new Contract(usdc.contractId(env.stellar.networkPassphrase));
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
    console.warn(
      `[preflight] could not read USDC balance for smart wallet ${walletContractId}; skipping funding check`,
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

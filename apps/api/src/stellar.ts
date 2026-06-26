/**
 * Stellar service layer for the API.
 *
 * Builds + simulates contract-invocation transactions (returns unsigned XDR for
 * the wallet), submits wallet-signed XDR, parses return values, and runs the
 * Horizon-based pre-flight checks (trustline / balance) before asking a user to
 * sign. The API never holds a private key.
 */

import {
  Asset,
  BASE_FEE,
  Horizon,
  Operation,
  TransactionBuilder,
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

/** Build an unsigned classic `changeTrust` tx so a user can trust a card asset. */
export async function buildTrustlineTx(account: string, asset: Asset): Promise<string> {
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

import { TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from '../env.js';
import { PreflightError, submitSignedTx, transactionReturnValue } from '../stellar.js';
import { relaySubmitter } from '../relay.js';

export interface Settlement {
  hash: string;
  returnValue: unknown;
  successful: true;
}

export function txSource(signedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(signedXdr, env.stellar.networkPassphrase);
  return 'source' in tx ? tx.source : tx.innerTransaction.source;
}

export async function signed(signedXdr: string): Promise<Settlement> {
  const result = await submitSignedTx(signedXdr);
  if (!result.successful) {
    throw new PreflightError('Transaction did not succeed on-chain', 'TX_FAILED', {
      hash: result.hash,
    });
  }
  return {
    hash: result.hash,
    returnValue: result.returnValue,
    successful: true,
  };
}

export async function relayed(signedXdr: string): Promise<Settlement> {
  const result = await relaySubmitter().submit(signedXdr);
  if (!result.successful) {
    throw new PreflightError('Relayed transaction did not succeed on-chain', 'TX_FAILED', {
      hash: result.hash,
    });
  }
  const returnValue = await transactionReturnValue(result.hash);
  return {
    hash: result.hash,
    returnValue,
    successful: true,
  };
}

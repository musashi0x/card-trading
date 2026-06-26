/**
 * Stellar Wallets Kit wrapper (Freighter + others). Client-only — the kit
 * touches `window`, so it is created lazily.
 */

import {
  FREIGHTER_ID,
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
} from '@creit.tech/stellar-wallets-kit';

let kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (typeof window === 'undefined') {
    throw new Error('Wallet is only available in the browser');
  }
  if (!kit) {
    kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: allowAllModules(),
    });
  }
  return kit;
}

/** Open the wallet picker and return the chosen address. */
export async function connectWallet(): Promise<string> {
  const k = getKit();
  return new Promise<string>((resolve, reject) => {
    k.openModal({
      onWalletSelected: async (option) => {
        try {
          k.setWallet(option.id);
          const { address } = await k.getAddress();
          resolve(address);
        } catch (err) {
          reject(err);
        }
      },
      onClosed: () => reject(new Error('Wallet selection cancelled')),
    });
  });
}

/** Sign an unsigned transaction XDR with the connected wallet. */
export async function signXdr(
  xdr: string,
  address: string,
  networkPassphrase: string,
): Promise<string> {
  const { signedTxXdr } = await getKit().signTransaction(xdr, {
    address,
    networkPassphrase,
  });
  return signedTxXdr;
}

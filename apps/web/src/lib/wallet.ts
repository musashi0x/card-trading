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

/** A connected classic wallet: its address plus the kit's wallet id (for reconnect). */
export interface ClassicConnection {
  address: string;
  walletId: string;
}

/** Open the wallet picker and return the chosen address and wallet id. */
export async function connectWallet(): Promise<ClassicConnection> {
  const k = getKit();
  return new Promise<ClassicConnection>((resolve, reject) => {
    k.openModal({
      onWalletSelected: async (option) => {
        try {
          k.setWallet(option.id);
          const { address } = await k.getAddress();
          resolve({ address, walletId: option.id });
        } catch (err) {
          reject(err);
        }
      },
      onClosed: () => reject(new Error('Wallet selection cancelled')),
    });
  });
}

/**
 * Re-point the kit at a previously selected wallet without opening the picker.
 * Used to rehydrate a persisted session on reload so signing targets the same
 * wallet the user originally connected.
 */
export function setActiveWallet(walletId: string): void {
  getKit().setWallet(walletId);
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

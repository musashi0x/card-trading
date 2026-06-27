'use client';

/**
 * Passkey smart-wallet wrapper (passkey-kit). Client-only — it runs the WebAuthn
 * ceremony and touches `window`/`localStorage`, so the kit is created lazily.
 *
 * A passkey wallet is a Soroban contract account (a `C…` address) authorized by
 * a secp256r1 passkey. `connectPasskey` creates one on first use (storing the
 * credential id for recovery) and reconnects to it thereafter. `signBuyNow` /
 * `signMakeOffer` build the marketplace call with the smart wallet as buyer,
 * trigger one biometric prompt to sign its authorization entry, and return the
 * signed envelope for the API to relay (gasless).
 */

import { PasskeyKit } from 'passkey-kit';
import { Account, BASE_FEE, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import {
  FULFILLMENT,
  MarketplaceContract,
  toStroops,
  type FulfillmentMode,
  type SmartWalletAccount,
} from '@cardmkt/shared';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';
const WALLET_WASM_HASH = process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH ?? '';
const RP_ID = process.env.NEXT_PUBLIC_PASSKEY_RP_ID || undefined;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';
// A funded classic account used only as the simulation source; the relayer
// rewrites the real source + fees on submit, so this never pays.
const FEE_SOURCE = process.env.NEXT_PUBLIC_FEE_SOURCE ?? '';
const KEY_STORAGE = 'topdeck.passkey.keyId';
const APP_NAME = 'TopDeck';

let kit: PasskeyKit | null = null;
let pendingDeployXdr: string | null = null;

function getKit(): PasskeyKit {
  if (typeof window === 'undefined') {
    throw new Error('Passkey wallet is only available in the browser');
  }
  if (!kit) {
    kit = new PasskeyKit({
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      walletWasmHash: WALLET_WASM_HASH,
    });
  }
  return kit;
}

/** Whether the device/browser exposes a WebAuthn platform authenticator. */
export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}

/** Whether the deploy/contract config needed for passkey checkout is present. */
export function passkeyConfigured(): boolean {
  return Boolean(WALLET_WASM_HASH && CONTRACT_ID && FEE_SOURCE);
}

/** Whether the passkey option should be offered at all. */
export function passkeyEnabled(): boolean {
  return passkeySupported() && passkeyConfigured();
}

/**
 * Connect a passkey smart wallet: reconnect to the stored credential if present,
 * otherwise create a new wallet. A newly created wallet's deployment is held and
 * bundled with the first purchase (deploy-on-first-use).
 */
export async function connectPasskey(): Promise<SmartWalletAccount & { isNew: boolean }> {
  const k = getKit();
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_STORAGE) : null;
  try {
    if (stored) {
      const res = await k.connectWallet({ keyId: stored, rpId: RP_ID });
      return { contractId: res.contractId, keyId: res.keyIdBase64, isNew: false };
    }
    const res = await k.createWallet(APP_NAME, 'TopDeck buyer', { rpId: RP_ID });
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY_STORAGE, res.keyIdBase64);
    pendingDeployXdr = res.signedTx.toXDR();
    return { contractId: res.contractId, keyId: res.keyIdBase64, isNew: true };
  } catch (err) {
    // WebAuthn reports cancellation, timeout, and origin/rpId mismatch all as the
    // same opaque NotAllowedError. Rewrite it into something actionable.
    if ((err as Error)?.name === 'NotAllowedError') {
      const host = typeof location !== 'undefined' ? location.host : '';
      throw new Error(
        `Passkey prompt was cancelled, timed out, or this page isn't served at the ` +
          `passkey domain (rpId="${RP_ID ?? 'auto'}", current host="${host}"). Open the ` +
          `app at http://localhost:3000 and complete the biometric prompt promptly.`,
        { cause: err },
      );
    }
    throw err;
  }
}

/** Take (and clear) a pending deploy envelope, if the wallet was just created. */
export function takePendingDeploy(): string | null {
  const xdr = pendingDeployXdr;
  pendingDeployXdr = null;
  return xdr;
}

/** Forget the connected passkey wallet (the credential itself is not removed). */
export function disconnectPasskey(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY_STORAGE);
  pendingDeployXdr = null;
}

/** Build + passkey-sign a `buy_now` with the smart wallet as buyer; return XDR. */
export async function signBuyNow(
  wallet: SmartWalletAccount,
  contractListingId: number,
): Promise<string> {
  const op = new MarketplaceContract(CONTRACT_ID).buyNow(wallet.contractId, contractListingId);
  return signWalletCall(wallet, op);
}

/** Build + passkey-sign a `make_offer` with the smart wallet as buyer; return XDR. */
export async function signMakeOffer(
  wallet: SmartWalletAccount,
  contractListingId: number,
  amountUsdc: string,
): Promise<string> {
  const op = new MarketplaceContract(CONTRACT_ID).makeOffer(
    wallet.contractId,
    contractListingId,
    toStroops(amountUsdc),
  );
  return signWalletCall(wallet, op);
}

/** Build + passkey-sign a `list` with the smart wallet as seller; return XDR. */
export async function signList(
  wallet: SmartWalletAccount,
  cardToken: string,
  priceUsdc: string,
  fulfillment: FulfillmentMode = 'digital',
): Promise<string> {
  const op = new MarketplaceContract(CONTRACT_ID).list(
    wallet.contractId,
    cardToken,
    toStroops(priceUsdc),
    FULFILLMENT[fulfillment],
  );
  return signWalletCall(wallet, op);
}

/** Build + passkey-sign a `purchase_escrow` with the smart wallet as buyer; return XDR. */
export async function signPurchaseEscrow(
  wallet: SmartWalletAccount,
  contractListingId: number,
): Promise<string> {
  const op = new MarketplaceContract(CONTRACT_ID).purchaseEscrow(wallet.contractId, contractListingId);
  return signWalletCall(wallet, op);
}

/** Build + passkey-sign a `confirm_receipt` with the smart wallet as buyer; return XDR. */
export async function signConfirmReceipt(
  wallet: SmartWalletAccount,
  contractOrderId: number,
): Promise<string> {
  const op = new MarketplaceContract(CONTRACT_ID).confirmReceipt(wallet.contractId, contractOrderId);
  return signWalletCall(wallet, op);
}

/** Build + passkey-sign a `dispute` with the smart wallet as a participant; return XDR. */
export async function signDispute(
  wallet: SmartWalletAccount,
  contractOrderId: number,
): Promise<string> {
  const op = new MarketplaceContract(CONTRACT_ID).dispute(wallet.contractId, contractOrderId);
  return signWalletCall(wallet, op);
}

/** Build + passkey-sign a `mark_shipped` with the smart wallet as seller; return XDR. */
export async function signMarkShipped(
  wallet: SmartWalletAccount,
  contractOrderId: number,
): Promise<string> {
  const op = new MarketplaceContract(CONTRACT_ID).markShipped(wallet.contractId, contractOrderId);
  return signWalletCall(wallet, op);
}

async function signWalletCall(
  wallet: SmartWalletAccount,
  op: ReturnType<MarketplaceContract['buyNow']>,
): Promise<string> {
  const k = getKit();
  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
  // Placeholder source: simulation discovers the smart wallet's auth entry; the
  // relayer supplies the real source + fees on submit.
  const tx = new TransactionBuilder(new Account(FEE_SOURCE, '0'), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();
  const prepared = await server.prepareTransaction(tx);
  const signed = await k.sign(prepared, { keyId: wallet.keyId });
  return signed.toXDR();
}

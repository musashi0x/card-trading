'use client';

/**
 * Wallet context (task 6.1): connect/disconnect, the connected address, and a
 * `runAction` helper that drives the full build -> sign -> submit flow so every
 * trade action goes through one place.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type {
  Card,
  FulfillmentMode,
  MintCardRequest,
  PathQuoteResponse,
  SmartWalletAccount,
  TradeAction,
} from '@cardmkt/shared';
import { ApiRequestError, api, type ProposeSwapBody, type SwapAction } from '@/lib/api';
import { connectWallet, signXdr } from '@/lib/wallet';
import {
  connectPasskey,
  disconnectPasskey,
  passkeyEnabled,
  signBuyNow,
  signConfirmReceipt,
  signDispute,
  signList,
  signMarkShipped,
  signPurchaseEscrow,
  takePendingDeploy,
} from '@/lib/passkey';

/** Order actions a participant can take on an in-flight escrow order. */
export type OrderAction = 'confirm_receipt' | 'dispute' | 'mark_shipped' | 'claim_timeout';

/** How the connected account authorizes: classic keypair/extension vs. passkey. */
export type WalletKind = 'classic' | 'passkey';

interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  /** The kind of the connected wallet, or `null` when disconnected. */
  walletKind: WalletKind | null;
  /** Whether a passkey smart wallet can be offered on this device/build. */
  passkeyAvailable: boolean;
  connect: () => Promise<void>;
  /** Connect (or create) a passkey smart wallet via Face ID / Touch ID. */
  connectViaPasskey: () => Promise<void>;
  disconnect: () => void;
  runAction: (action: TradeAction, body: Record<string, unknown>) => Promise<string>;
  /**
   * Buy a listing with the connected passkey smart wallet: one biometric prompt,
   * gasless relay. Deploys the wallet first when needed (deploy-on-first-use).
   * Returns the settlement tx hash.
   */
  passkeyBuyNow: (listingId: string, contractListingId: number) => Promise<string>;
  /**
   * List a card for sale with the connected passkey smart wallet: one biometric
   * prompt, gasless relay. Deploys the wallet first when needed. Returns the
   * on-chain `list` tx hash.
   */
  passkeyList: (
    cardId: string,
    cardToken: string,
    priceUsdc: string,
    fulfillment?: FulfillmentMode,
  ) => Promise<string>;
  /**
   * Buy a physical listing through the delivery-confirmation escrow: funds are
   * held by the contract until receipt is confirmed (or a timeout / dispute
   * resolves). Works for both classic and passkey wallets. Returns the tx hash.
   */
  escrowPurchase: (listingId: string, contractListingId: number) => Promise<string>;
  /**
   * Take a participant action on an in-flight escrow order (confirm receipt,
   * dispute, mark shipped, or claim a timed-out order). Returns the tx hash.
   */
  orderAction: (
    action: OrderAction,
    orderId: string,
    contractOrderId: number,
  ) => Promise<string>;
  establishTrustline: (cardId: string) => Promise<string>;
  /**
   * Propose a barter trade: build the `propose_swap` tx, sign it, and submit so
   * the give-side cards lock into custody. Returns the new proposal id and tx
   * hash. Classic wallets only (passkey swaps are a follow-up).
   */
  proposeSwap: (body: Omit<ProposeSwapBody, 'proposer'>) => Promise<{ proposalId: string; hash: string }>;
  /**
   * Act on an existing proposal (accept / decline / cancel): build the matching
   * swap tx, sign it, and submit. Returns the settlement tx hash.
   */
  swapAction: (id: string, action: SwapAction) => Promise<string>;
  /**
   * Mint (issue) a brand-new card asset owned by the connected wallet, returning
   * the created card. A passkey wallet receives its copies gaslessly; a classic
   * wallet signs a one-time trustline so the issuer can deliver them.
   */
  mintCard: (meta: Omit<MintCardRequest, 'owner'>) => Promise<Card>;
  /**
   * Convert a source asset into the USDC a settlement needs (pay-with-any-asset).
   * Signs an optional USDC `change_trust`, then the path payment. Returns the
   * conversion tx hash, or `null` when the quote needs no conversion.
   */
  payWithAsset: (quote: PathQuoteResponse) => Promise<string | null>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletKind, setWalletKind] = useState<WalletKind | null>(null);
  const smartWallet = useRef<SmartWalletAccount | null>(null);
  // Synchronous re-entry guard for the passkey ceremony: `connecting` state lags a
  // render behind, so a fast double-click could start two WebAuthn ceremonies.
  const passkeyInFlight = useRef(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      setAddress(await connectWallet());
      setWalletKind('classic');
      smartWallet.current = null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectViaPasskey = useCallback(async () => {
    // A second ceremony started while the first dialog is open aborts the pending
    // one with a misleading NotAllowedError — ignore overlapping invocations.
    if (passkeyInFlight.current) return;
    passkeyInFlight.current = true;
    setConnecting(true);
    try {
      const wallet = await connectPasskey();
      smartWallet.current = { contractId: wallet.contractId, keyId: wallet.keyId };
      setAddress(wallet.contractId);
      setWalletKind('passkey');
      // Fund a freshly created wallet with test USDC (dev only) so the first
      // purchase has funds. Best-effort: the route is testnet-gated and absent
      // in production, so ignore failures.
      if (wallet.isNew) {
        try {
          await api.devFundWallet(wallet.contractId);
        } catch (err) {
          console.warn('[passkey] dev funding skipped:', (err as Error).message);
        }
      }
    } finally {
      passkeyInFlight.current = false;
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (walletKind === 'passkey') disconnectPasskey();
    smartWallet.current = null;
    setWalletKind(null);
    setAddress(null);
  }, [walletKind]);

  const passkeyBuyNow = useCallback(
    async (listingId: string, contractListingId: number): Promise<string> => {
      const wallet = smartWallet.current;
      if (!wallet) throw new Error('Connect a passkey wallet first');
      // Deploy-on-first-use: relay the held deployment before the first call so
      // the wallet exists to authorize it.
      const deploy = takePendingDeploy();
      if (deploy) await api.passkeyDeploy(deploy);
      const signedXdr = await signBuyNow(wallet, contractListingId);
      const { hash } = await api.passkeySubmit({
        action: 'buy_now',
        listingId,
        buyer: wallet.contractId,
        signedXdr,
      });
      return hash;
    },
    [],
  );

  const passkeyList = useCallback(
    async (
      cardId: string,
      cardToken: string,
      priceUsdc: string,
      fulfillment: FulfillmentMode = 'digital',
    ): Promise<string> => {
      const wallet = smartWallet.current;
      if (!wallet) throw new Error('Connect a passkey wallet first');
      // Deploy-on-first-use: relay the held deployment before the first call so
      // the wallet exists to authorize it.
      const deploy = takePendingDeploy();
      if (deploy) await api.passkeyDeploy(deploy);
      const signedXdr = await signList(wallet, cardToken, priceUsdc, fulfillment);
      const { hash } = await api.passkeyList({
        cardId,
        seller: wallet.contractId,
        priceUsdc,
        signedXdr,
      });
      return hash;
    },
    [],
  );

  /** Buy a physical listing through the held escrow (classic or passkey). */
  const escrowPurchase = useCallback(
    async (listingId: string, contractListingId: number): Promise<string> => {
      if (walletKind === 'passkey') {
        const wallet = smartWallet.current;
        if (!wallet) throw new Error('Connect a passkey wallet first');
        const deploy = takePendingDeploy();
        if (deploy) await api.passkeyDeploy(deploy);
        const signedXdr = await signPurchaseEscrow(wallet, contractListingId);
        const { hash } = await api.passkeyOrder({
          action: 'purchase_escrow',
          account: wallet.contractId,
          listingId,
          signedXdr,
        });
        return hash;
      }
      if (!address) throw new Error('Connect a wallet first');
      const built = await api.build('purchase_escrow', { listingId, buyer: address });
      const signed = await signXdr(built.xdr, address, built.networkPassphrase);
      const { hash } = await api.submit(signed, 'purchase_escrow', built.refId);
      return hash;
    },
    [address, walletKind],
  );

  /** A participant action on an existing escrow order (classic or passkey). */
  const orderAction = useCallback(
    async (action: OrderAction, orderId: string, contractOrderId: number): Promise<string> => {
      if (walletKind === 'passkey') {
        if (action === 'claim_timeout') {
          throw new Error('Timeout release is available from a classic wallet only');
        }
        const wallet = smartWallet.current;
        if (!wallet) throw new Error('Connect a passkey wallet first');
        const sign =
          action === 'confirm_receipt'
            ? signConfirmReceipt
            : action === 'dispute'
              ? signDispute
              : signMarkShipped;
        const signedXdr = await sign(wallet, contractOrderId);
        const { hash } = await api.passkeyOrder({
          action,
          account: wallet.contractId,
          orderId,
          signedXdr,
        });
        return hash;
      }
      if (!address) throw new Error('Connect a wallet first');
      const built = await api.build(action, { orderId, account: address });
      const signed = await signXdr(built.xdr, address, built.networkPassphrase);
      const { hash } = await api.submit(signed, action, built.refId);
      return hash;
    },
    [address, walletKind],
  );

  /** build -> sign -> submit, returning the settlement/escrow tx hash. */
  const runAction = useCallback(
    async (action: TradeAction, body: Record<string, unknown>): Promise<string> => {
      if (!address) throw new Error('Connect a wallet first');
      const built = await api.build(action, body);
      const signed = await signXdr(built.xdr, address, built.networkPassphrase);
      const { hash } = await api.submit(signed, action, built.refId);
      return hash;
    },
    [address],
  );

  /** Sign + submit a classic changeTrust so the buyer can receive a card. */
  const establishTrustline = useCallback(
    async (cardId: string): Promise<string> => {
      if (!address) throw new Error('Connect a wallet first');
      const built = await api.buildTrustline(address, cardId);
      const signed = await signXdr(built.xdr, address, built.networkPassphrase);
      const { hash } = await api.submitClassic(signed);
      return hash;
    },
    [address],
  );

  /** Propose a barter trade (classic build → sign → submit). */
  const proposeSwap = useCallback(
    async (body: Omit<ProposeSwapBody, 'proposer'>): Promise<{ proposalId: string; hash: string }> => {
      if (!address) throw new Error('Connect a wallet first');
      if (walletKind === 'passkey') {
        throw new Error('Barter trades currently require a classic wallet');
      }
      const built = await api.proposeSwapBuild({ ...body, proposer: address });
      const signed = await signXdr(built.xdr, address, built.networkPassphrase);
      const { hash } = await api.proposeSwapSubmit(built.proposalId, signed);
      return { proposalId: built.proposalId, hash };
    },
    [address, walletKind],
  );

  /** Accept / decline / cancel a proposal (classic build → sign → submit). */
  const swapAction = useCallback(
    async (id: string, action: SwapAction): Promise<string> => {
      if (!address) throw new Error('Connect a wallet first');
      if (walletKind === 'passkey') {
        throw new Error('Barter trades currently require a classic wallet');
      }
      const built = await api.swapActionBuild(id, action, address);
      const signed = await signXdr(built.xdr, address, built.networkPassphrase);
      const { hash } = await api.swapActionSubmit(id, action, address, signed);
      return hash;
    },
    [address, walletKind],
  );

  const mintCard = useCallback(
    async (meta: Omit<MintCardRequest, 'owner'>): Promise<Card> => {
      if (!address) throw new Error('Connect a wallet first');
      const res = await api.mintCard({ ...meta, owner: address });
      // A passkey/smart wallet was funded its copies server-side already.
      if (res.minted) return res.card;
      // Classic owner: sign the one-time trustline, then claim the copies.
      if (!res.trustlineXdr || !res.networkPassphrase) {
        throw new Error('Mint did not return a trustline to sign');
      }
      const signed = await signXdr(res.trustlineXdr, address, res.networkPassphrase);
      await api.submitClassic(signed);
      const claimed = await api.distributeCard(res.card.id, address);
      return claimed.card;
    },
    [address],
  );

  const payWithAsset = useCallback(
    async (quote: PathQuoteResponse): Promise<string | null> => {
      if (!address) throw new Error('Connect a wallet first');
      // A zero-conversion quote means the buyer already holds enough USDC.
      if (Number(quote.destUsdc) <= 0) return null;

      const buildBody = {
        buyer: address,
        sourceAsset: quote.sourceAsset,
        destUsdc: quote.destUsdc,
        sendMax: quote.sendMax,
        path: quote.path,
      };
      let built;
      try {
        built = await api.pathPayment(buildBody);
      } catch (err) {
        // Missing USDC trustline: sign the returned change_trust, then retry.
        if (
          err instanceof ApiRequestError &&
          err.code === 'MISSING_TRUSTLINE' &&
          typeof err.details?.xdr === 'string'
        ) {
          const ctSigned = await signXdr(
            err.details.xdr,
            address,
            String(err.details.networkPassphrase),
          );
          await api.submitClassic(ctSigned);
          built = await api.pathPayment(buildBody);
        } else {
          throw err;
        }
      }
      const signed = await signXdr(built.xdr, address, built.networkPassphrase);
      const { hash } = await api.submitClassic(signed);
      return hash;
    },
    [address],
  );

  const value = useMemo(
    () => ({
      address,
      connecting,
      walletKind,
      passkeyAvailable: passkeyEnabled(),
      connect,
      connectViaPasskey,
      disconnect,
      runAction,
      passkeyBuyNow,
      passkeyList,
      escrowPurchase,
      orderAction,
      establishTrustline,
      proposeSwap,
      swapAction,
      mintCard,
      payWithAsset,
    }),
    [
      address,
      connecting,
      walletKind,
      connect,
      connectViaPasskey,
      disconnect,
      runAction,
      passkeyBuyNow,
      passkeyList,
      escrowPurchase,
      orderAction,
      establishTrustline,
      proposeSwap,
      swapAction,
      mintCard,
      payWithAsset,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

export { ApiRequestError };

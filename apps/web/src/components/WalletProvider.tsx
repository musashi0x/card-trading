'use client';

/**
 * Wallet context (task 6.1): connect/disconnect, the connected address, and a
 * `runAction` helper that drives the full build -> sign -> submit flow so every
 * trade action goes through one place.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { TradeAction } from '@cardmkt/shared';
import { ApiRequestError, api } from '@/lib/api';
import { connectWallet, signXdr } from '@/lib/wallet';

interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  runAction: (action: TradeAction, body: Record<string, unknown>) => Promise<string>;
  establishTrustline: (cardId: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      setAddress(await connectWallet());
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

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

  const value = useMemo(
    () => ({ address, connecting, connect, disconnect, runAction, establishTrustline }),
    [address, connecting, connect, disconnect, runAction, establishTrustline],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

export { ApiRequestError };

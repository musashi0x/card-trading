'use client';

/**
 * TopDeck entry point: loads real marketplace data + the wallet context, then
 * hands them to the design component. While the first fetch is in flight a
 * branded splash is shown; if the API is unreachable or has no open listings we
 * fall back to demo cards so the marketplace is never empty.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  invalidateOrders,
  useCards,
  useDisputedOrders,
  useListings,
  useOrders,
} from '@/lib/queries';
import { explorerAccount, explorerTx } from '@/lib/explorer';
import { useWallet, type OrderAction } from '@/components/WalletProvider';
import { TopDeckApp } from './TopDeckApp';
import { mapListing, mockCards, type TopCard } from './lib';

const INK = '#1a1305';

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: '#fff7ec', color: INK, fontFamily: "'DM Sans',system-ui" }}>
      <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 40, letterSpacing: '-.03em' }}>TOP<span style={{ color: '#ff4d3d' }}>DECK</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d3d', animation: 'pulseDot 1.3s infinite' }} />Loading live auctions…
      </div>
    </div>
  );
}

export function TopDeck() {
  const {
    address,
    connecting,
    walletKind,
    passkeyAvailable,
    connect,
    connectViaPasskey,
    disconnect,
    runAction,
    passkeyBuyNow,
    passkeyList,
    escrowPurchase,
    orderAction,
    mintCard,
    payWithAsset,
  } = useWallet();
  const { data: listings, isPending: listingsPending, isError: listingsError } = useListings();

  // Map live listings to seed cards; fall back to demo cards when the API is
  // unreachable or has no open listings, so the marketplace is never empty.
  const seed = useMemo<TopCard[] | null>(() => {
    if (listingsPending) return null;
    if (listingsError || !listings) return mockCards();
    const base = Date.now();
    const mapped = listings.filter((l) => l.card).map((l) => mapListing(l, base));
    return mapped.length ? mapped : mockCards(base);
  }, [listings, listingsPending, listingsError]);

  // The Sell flow's "a card I hold" picker shows only the connected wallet's own
  // cards. The hook is disabled (and returns no data) when no wallet is
  // connected — you can't list what you don't hold — and refetches on reconnect.
  const { data: catalog = [] } = useCards(address);

  // Escrow orders + open disputes for the connected wallet. Both are gated on a
  // connected wallet, so they sit idle (no fetch) until one connects.
  const ordersQuery = useOrders(address);
  const disputedQuery = useDisputedOrders(!!address);
  const queryClient = useQueryClient();
  const refreshOrders = useCallback(
    () => invalidateOrders(queryClient, address),
    [queryClient, address],
  );

  // Order-mutating actions, each refetching the order reads on success so the
  // Orders screen stays in sync without manual reloads. The class component
  // calls these (the first two transparently via `wallet`) and manages its own
  // per-row busy state and toasts.
  const orderActionMut = useMutation({
    mutationFn: (v: { action: OrderAction; orderId: string; contractOrderId: number }) =>
      orderAction(v.action, v.orderId, v.contractOrderId),
    onSuccess: refreshOrders,
  });
  const escrowPurchaseMut = useMutation({
    mutationFn: (v: { listingId: string; contractListingId: number }) =>
      escrowPurchase(v.listingId, v.contractListingId),
    onSuccess: refreshOrders,
  });
  const resolveOrderMut = useMutation({
    mutationFn: (v: { orderId: string; refund: boolean }) =>
      api.resolveOrder(v.orderId, v.refund).then((r) => r.hash),
    onSuccess: refreshOrders,
  });

  if (!seed) return <Splash />;

  return (
    <TopDeckApp
      wallet={{
        address,
        connecting,
        walletKind,
        passkeyAvailable,
        connect,
        connectViaPasskey,
        disconnect,
        runAction: (action, body) => runAction(action, body),
        passkeyBuyNow,
        passkeyList,
        // Mutation-wrapped so a purchase / order action auto-refreshes orders.
        escrowPurchase: (listingId, contractListingId) =>
          escrowPurchaseMut.mutateAsync({ listingId, contractListingId }),
        orderAction: (action, orderId, contractOrderId) =>
          orderActionMut.mutateAsync({ action, orderId, contractOrderId }),
        mintCard,
        payWithAsset,
      }}
      orders={{
        data: ordersQuery.data ?? [],
        disputed: disputedQuery.data ?? [],
        // Only the initial load shows the spinner; background refetches are silent.
        loading: ordersQuery.isLoading,
        error: !address
          ? 'Connect a wallet to see your orders'
          : ordersQuery.error
            ? (ordersQuery.error as Error).message
            : null,
        resolve: (orderId, refund) => resolveOrderMut.mutateAsync({ orderId, refund }),
        refresh: refreshOrders,
      }}
      seedCards={seed}
      catalog={catalog}
      explorerTx={explorerTx}
      explorerAddress={explorerAccount}
    />
  );
}

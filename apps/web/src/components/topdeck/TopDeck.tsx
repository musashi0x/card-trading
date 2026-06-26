'use client';

/**
 * TopDeck entry point: loads real marketplace data + the wallet context, then
 * hands them to the design component. While the first fetch is in flight a
 * branded splash is shown; if the API is unreachable or has no open listings we
 * fall back to demo cards so the marketplace is never empty.
 */

import { useEffect, useState } from 'react';
import type { Card } from '@cardmkt/shared';
import { api } from '@/lib/api';
import { explorerTx } from '@/lib/explorer';
import { useWallet } from '@/components/WalletProvider';
import { TopDeckApp } from './TopDeckApp';
import { mapListing, mockCards, type TopCard } from './lib';

const INK = '#1a1305';

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: '#fff7ec', color: INK, fontFamily: "'DM Sans',system-ui" }}>
      <img src="/logo.png" alt="TopDeck Logo" style={{ width: 80, height: 80, borderRadius: '50%', border: `3px solid ${INK}`, marginBottom: 8 }} />
      <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 40, letterSpacing: '-.03em' }}>TOP<span style={{ color: '#ff4d3d' }}>DECK</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d3d', animation: 'pulseDot 1.3s infinite' }} />Loading live auctions…
      </div>
    </div>
  );
}

export function TopDeck() {
  const { address, connecting, connect, disconnect, runAction } = useWallet();
  const [seed, setSeed] = useState<TopCard[] | null>(null);
  const [catalog, setCatalog] = useState<Card[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const listings = await api.listings();
        const base = Date.now();
        const mapped = listings.filter((l) => l.card).map((l) => mapListing(l, base));
        if (active) setSeed(mapped.length ? mapped : mockCards(base));
      } catch {
        if (active) setSeed(mockCards());
      }
    })();
    api.cards().then((c) => active && setCatalog(c)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!seed) return <Splash />;

  return (
    <TopDeckApp
      wallet={{ address, connecting, connect, disconnect, runAction: (action, body) => runAction(action, body) }}
      seedCards={seed}
      catalog={catalog}
      explorerTx={explorerTx}
    />
  );
}

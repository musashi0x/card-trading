'use client';

/** Verifiable trade history (task 6.7) — each settlement links to the explorer. */

import { useEffect, useState } from 'react';
import type { Trade } from '@cardmkt/shared';
import { api } from '@/lib/api';
import { explorerTx } from '@/lib/explorer';

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Trades() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .trades()
      .then(setTrades)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ paddingTop: '1rem' }}>
      <h1>Settlements</h1>
      <p className="muted">Every trade settled atomically on-chain. Click a hash to verify.</p>
      {loading && <p className="muted">Loading…</p>}
      {!loading && trades.length === 0 && <p className="muted">No settlements yet.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
        {trades.map((t) => (
          <div
            key={t.id}
            className="panel"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}
          >
            <div>
              <div>
                {shorten(t.buyer)} → {shorten(t.seller)}
              </div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                {t.priceUsdc} USDC · fee {t.feeUsdc} USDC
              </div>
            </div>
            <a href={explorerTx(t.settleTxHash)} target="_blank" rel="noreferrer">
              {shorten(t.settleTxHash)} ↗
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

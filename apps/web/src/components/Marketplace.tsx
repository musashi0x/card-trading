'use client';

/** Browse + search the marketplace (task 6.2). */

import { useCallback, useEffect, useState } from 'react';
import type { Listing } from '@cardmkt/shared';
import { api } from '@/lib/api';
import { ListingTile } from './ListingTile';

export function Marketplace() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    setError(null);
    try {
      setListings(await api.listings(search ? { q: search } : undefined));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingTop: '1rem' }}>
      <div>
        <h1 style={{ margin: '0 0 0.25rem' }}>Trade cards with on-chain escrow</h1>
        <p className="muted" style={{ margin: 0 }}>
          Offers lock USDC in a Soroban contract. Settlement is atomic — card and payment swap in one
          transaction, with a transparent platform fee. Withdraw any open offer at any time.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
        style={{ display: 'flex', gap: '0.5rem' }}
      >
        <input
          placeholder="Search by name, set, or rarity…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit">Search</button>
      </form>

      {loading && <p className="muted">Loading…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!loading && listings.length === 0 && <p className="muted">No open listings yet.</p>}

      <div className="card-grid">
        {listings.map((l) => (
          <ListingTile key={l.id} listing={l} onChanged={() => load(q)} />
        ))}
      </div>
    </div>
  );
}

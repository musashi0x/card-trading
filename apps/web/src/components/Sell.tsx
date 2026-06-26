'use client';

/** List a card for sale (task 6.3). The API pre-flight rejects cards you don't hold. */

import { useEffect, useState } from 'react';
import type { Card } from '@cardmkt/shared';
import { api } from '@/lib/api';
import { useWallet } from './WalletProvider';
import { explorerTx } from '@/lib/explorer';

export function Sell() {
  const { address, runAction } = useWallet();
  const [cards, setCards] = useState<Card[]>([]);
  const [cardId, setCardId] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; hash?: string; error?: boolean } | null>(null);

  useEffect(() => {
    api.cards().then(setCards).catch(() => setCards([]));
  }, []);

  async function list() {
    setBusy(true);
    setMsg(null);
    try {
      const hash = await runAction('list', { cardId, seller: address, priceUsdc: price });
      setMsg({ text: 'Listed — card locked in escrow', hash });
      setCardId('');
      setPrice('');
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  if (!address) {
    return <p className="muted">Connect a wallet to list a card.</p>;
  }

  return (
    <div className="panel" style={{ maxWidth: 480, marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <h2 style={{ margin: 0 }}>List a card</h2>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Listing locks one copy of the card into the settlement contract until a buyer settles or you
        cancel.
      </p>
      <label>
        Card
        <select value={cardId} onChange={(e) => setCardId(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
          <option value="">Select a card…</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.rarity})
            </option>
          ))}
        </select>
      </label>
      <label>
        Price (USDC)
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="50"
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>
      <button onClick={list} disabled={busy || !cardId || !price}>
        {busy ? 'Listing…' : 'List for sale'}
      </button>
      {msg && (
        <div style={{ fontSize: '0.85rem', color: msg.error ? 'var(--danger)' : 'var(--accent-2)' }}>
          {msg.text}
          {msg.hash && (
            <>
              {' '}
              <a href={explorerTx(msg.hash)} target="_blank" rel="noreferrer">
                view ↗
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

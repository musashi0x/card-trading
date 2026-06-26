'use client';

/**
 * A single listing with its trade actions (tasks 6.4–6.6):
 *  - buyer: Buy now / Make offer (with inline trustline prompt on MISSING_TRUSTLINE)
 *  - seller: Cancel listing / view + accept offers
 */

import { useState } from 'react';
import type { Listing, Offer } from '@cardmkt/shared';
import { ApiRequestError, useWallet } from './WalletProvider';
import { api } from '@/lib/api';
import { explorerTx } from '@/lib/explorer';

export function ListingTile({ listing, onChanged }: { listing: Listing; onChanged: () => void }) {
  const { address, runAction, establishTrustline } = useWallet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; hash?: string; error?: boolean } | null>(null);
  const [needsTrustline, setNeedsTrustline] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [offers, setOffers] = useState<Offer[] | null>(null);

  const isSeller = address && address === listing.seller;
  const card = listing.card!;

  async function run(fn: () => Promise<string>, label: string) {
    setBusy(true);
    setMsg(null);
    setNeedsTrustline(false);
    try {
      const hash = await fn();
      setMsg({ text: `${label} confirmed`, hash });
      onChanged();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'MISSING_TRUSTLINE') {
        setNeedsTrustline(true);
        setMsg({ text: 'You need a trustline to this card before you can receive it.', error: true });
      } else {
        setMsg({ text: (err as Error).message, error: true });
      }
    } finally {
      setBusy(false);
    }
  }

  const buyNow = () => run(() => runAction('buy_now', { listingId: listing.id, buyer: address }), 'Purchase');
  const makeOffer = () =>
    run(
      () => runAction('make_offer', { listingId: listing.id, buyer: address, amountUsdc: offerAmount }),
      'Offer',
    );
  const cancel = () => run(() => runAction('cancel_listing', { listingId: listing.id, seller: address }), 'Cancel');
  const trustline = () => run(() => establishTrustline(card.id), 'Trustline');

  async function loadOffers() {
    setOffers(await api.offers(listing.id));
  }
  const accept = (offerId: string) =>
    run(() => runAction('accept_offer', { offerId, seller: address }), 'Acceptance');

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={card.imageUrl}
        alt={card.name}
        style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 8 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{card.name}</strong>
        <span className="badge">{card.rarity}</span>
      </div>
      <div className="muted" style={{ fontSize: '0.85rem' }}>
        {card.set} · {listing.priceUsdc} USDC
      </div>

      {!isSeller && listing.status === 'open' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <button onClick={buyNow} disabled={busy || !address}>
            Buy now · {listing.priceUsdc} USDC
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <input
              placeholder="Offer (USDC)"
              value={offerAmount}
              onChange={(e) => setOfferAmount(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="secondary" onClick={makeOffer} disabled={busy || !address || !offerAmount}>
              Offer
            </button>
          </div>
        </div>
      )}

      {isSeller && listing.status === 'open' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <button className="secondary" onClick={loadOffers} disabled={busy}>
            View offers
          </button>
          {offers?.map((o) => (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem' }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {o.amountUsdc} USDC · {o.status}
              </span>
              {o.status === 'open' && (
                <button onClick={() => accept(o.id)} disabled={busy}>
                  Accept
                </button>
              )}
            </div>
          ))}
          {offers && offers.length === 0 && <span className="muted">No offers yet.</span>}
          <button className="danger" onClick={cancel} disabled={busy}>
            Cancel listing
          </button>
        </div>
      )}

      {listing.status !== 'open' && <span className="badge">{listing.status}</span>}

      {needsTrustline && (
        <button onClick={trustline} disabled={busy}>
          Establish trustline to {card.assetCode}
        </button>
      )}
      {msg && (
        <div className="muted" style={{ fontSize: '0.8rem', color: msg.error ? 'var(--danger)' : undefined }}>
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

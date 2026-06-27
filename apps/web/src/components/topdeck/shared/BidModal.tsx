'use client';

import { useTopDeck } from '../TopDeckProvider';
import { increment, money, type TopCard } from '../lib';
import { DISPLAY, INK } from '../theme';

/** Simulated bid modal — opened from the detail screen and the bid lists. */
export function BidModal({ card: c }: { card: TopCard }) {
  const td = useTopDeck();
  const st = td.state;
  const inc = increment(c.currentBid);
  const min = c.currentBid + inc;
  const amt = Number(st.bidAmount);
  const valid = amt >= min;
  const quickBids = [min, min + inc, min + 4 * inc];
  return (
    <div onClick={td.closeBid} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(26,19,5,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'overlayIn .15s ease both' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#fff7ec', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `8px 8px 0 ${INK}`, padding: 24, animation: 'modalIn .22s cubic-bezier(.2,.9,.3,1.3) both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 21 }}>Place your bid</div>
          <div onClick={td.closeBid} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `2.5px solid ${INK}`, background: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>✕</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(26,19,5,.55)', marginBottom: 18 }}>{c.name} · current bid {money(c.currentBid)}</div>

        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(26,19,5,.5)', marginBottom: 7 }}>YOUR MAX BID</div>
        <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, padding: '4px 16px' }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26 }}>$</span>
          <input type="number" value={st.bidAmount} onChange={td.onBidInput} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, color: INK, padding: '10px 6px', width: '100%' }} />
        </div>

        <div style={{ display: 'flex', gap: 9, marginTop: 12 }}>
          {quickBids.map((q, i) => (
            <div key={q} onClick={() => td.setBid(q)} style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700, padding: 11, border: `2.5px solid ${INK}`, borderRadius: 10, background: i === 0 ? '#ffd84d' : '#fff', color: INK, cursor: 'pointer' }}>{money(q)}</div>
          ))}
        </div>

        {st.bidAmount !== '' && !valid && (
          <div style={{ marginTop: 13, fontSize: 12.5, fontWeight: 700, color: '#ff4d3d' }}>Enter at least {money(min)}</div>
        )}

        <div onClick={td.confirmBid} style={{ marginTop: 18, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, padding: 16, border: `3px solid ${INK}`, borderRadius: 13, cursor: valid ? 'pointer' : 'default', background: valid ? '#ff4d3d' : '#e7ddc8', color: valid ? '#fff' : 'rgba(26,19,5,.4)', boxShadow: `3px 3px 0 ${INK}` }}>{valid ? `Confirm bid · ${money(amt)}` : 'Enter a higher bid'}</div>
        <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.45)', marginTop: 11 }}>Bids are simulated in this demo. Listings &amp; wallet are live on Stellar testnet.</div>
      </div>
    </div>
  );
}

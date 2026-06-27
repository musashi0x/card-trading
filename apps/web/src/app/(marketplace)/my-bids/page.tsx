'use client';

import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { INK, DISPLAY } from '@/components/topdeck/theme';
import { CardTile } from '@/components/topdeck/shared/CardTile';
import { rarityMeta, money, fmtLeft } from '@/components/topdeck/lib';
import type { TopCard } from '@/components/topdeck/lib';

export default function MyBidsPage() {
  const td = useTopDeck();
  const st = td.state;

  // ── derived values (mirrored from the old render()) ──────────────────────
  const statusMeta = (s: string) =>
    s === 'winning' ? { label: 'Winning', icon: '🏆', bg: '#bff3d4', col: '#0a5e34' }
      : s === 'outbid' ? { label: 'Outbid', icon: '⚡', bg: '#ffd1cc', col: '#a3160a' }
        : s === 'won' ? { label: 'Won', icon: '🎉', bg: INK, col: '#ffd84d' }
          : { label: 'Leading', icon: '•', bg: '#fff', col: INK };

  const involved = st.cards.filter((c) => st.myMax[c.id] != null || st.status[c.id] === 'won');
  const winningCount = involved.filter((c) => st.status[c.id] === 'winning').length;
  const outbidCount = involved.filter((c) => st.status[c.id] === 'outbid').length;
  const watchList = st.cards.filter((c) => st.watched[c.id]);
  const owned = st.cards.filter((c) => c.mine);
  const liveCount = owned.filter((c) => c.endsAt - st.now > 0).length;

  // ── renderBidding ─────────────────────────────────────────────────────────
  function renderBidding(
    involved: TopCard[],
    watchList: TopCard[],
    winningCount: number,
    outbidCount: number,
    statusMeta: (s: string) => { label: string; icon: string; bg: string; col: string },
  ) {
    const chip = (n: number | string, label: string, bg: string, col: string) => (
      <div style={{ flex: 1, minWidth: 150, background: bg, border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: col }}>{n}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: col === INK ? 'rgba(26,19,5,.55)' : col, marginTop: 4 }}>{label}</div>
      </div>
    );
    return (
      <>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '22px 0 28px' }}>
          {chip(involved.length, 'Active lots', '#fff', INK)}
          {chip(winningCount, '🏆 Winning', '#bff3d4', '#0a5e34')}
          {chip(outbidCount, '⚡ Outbid', '#ffd1cc', '#a3160a')}
          {chip(watchList.length, '♥ Watching', '#ffd84d', INK)}
        </div>

        {involved.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {involved.map((c) => {
              const rm = rarityMeta(c.rarity);
              const left = c.endsAt - st.now;
              const ending = left < 3600000;
              const stt = st.status[c.id] || 'winning';
              const sm = statusMeta(stt);
              const isOutbid = stt === 'outbid';
              const myMax = st.myMax[c.id];
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '14px 16px' }}>
                  <div onClick={() => td.open(c.id)} style={{ position: 'relative', width: 80, height: 80, flex: 'none', borderRadius: 11, border: `2.5px solid ${INK}`, background: c.art, cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', bottom: 5, left: 5, fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 5, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div onClick={() => td.open(c.id)} style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>{c.name}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 7, border: `2px solid ${INK}`, marginTop: 7, background: sm.bg, color: sm.col }}>{sm.icon} {sm.label}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 80 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Your max</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{myMax != null ? money(myMax) : '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 90 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Current bid</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{money(c.currentBid)}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 78 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Ends in</div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: ending ? '#ff4d3d' : 'rgba(26,19,5,.55)' }}>⏱ {fmtLeft(left)}</div>
                  </div>
                  <div onClick={() => (isOutbid ? td.openBidFor(c.id) : td.open(c.id))} style={{ flex: 'none', textAlign: 'center', fontSize: 13, fontWeight: 800, padding: '11px 16px', border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer', background: isOutbid ? '#ff4d3d' : '#fff', color: isOutbid ? '#fff' : INK }}>{isOutbid ? 'Bid again' : 'View lot'}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '54px 24px', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16 }}>
            <div style={{ fontSize: 42 }}>🎴</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, marginTop: 10 }}>No bids yet</div>
            <div style={{ fontSize: 13.5, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 6 }}>Find a card you love and place your first bid.</div>
            <div onClick={td.goHome} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '13px 24px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Browse auctions</div>
          </div>
        )}

        {watchList.length > 0 && (
          <>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, margin: '36px 0 16px' }}>♥ Watchlist</div>
            <div className="td-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
              {watchList.map((c) => <CardTile key={c.id} card={c} height={150} />)}
            </div>
          </>
        )}
      </>
    );
  }

  // ── renderSelling ─────────────────────────────────────────────────────────
  function renderSelling(owned: TopCard[], liveCount: number) {
    return (
      <>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 26 }}>
          <div style={{ flex: 1, minWidth: 150, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1 }}>{owned.length}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 4 }}>Listings</div>
          </div>
          <div style={{ flex: 1, minWidth: 150, background: '#bff3d4', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: '#0a5e34' }}>{liveCount}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0a5e34', marginTop: 4 }}>● Live now</div>
          </div>
          <div onClick={td.goSell} style={{ flex: 1, minWidth: 150, background: '#ffd84d', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, lineHeight: 1.1 }}>+ List a card</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 4 }}>Start an auction</div>
          </div>
        </div>

        {owned.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {owned.map((c) => {
              const rm = rarityMeta(c.rarity);
              const left = c.endsAt - st.now;
              const live = left > 0;
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '14px 16px' }}>
                  <div onClick={() => td.open(c.id)} style={{ position: 'relative', width: 80, height: 80, flex: 'none', borderRadius: 11, border: `2.5px solid ${INK}`, background: c.art, cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', bottom: 5, left: 5, fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 5, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div onClick={() => td.open(c.id)} style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>{c.name}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 7, border: `2px solid ${INK}`, marginTop: 7, background: live ? '#bff3d4' : '#e7ddc8', color: live ? '#0a5e34' : 'rgba(26,19,5,.55)' }}>{live ? '● Live' : 'Ended'}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 84 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Top bid</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{money(c.currentBid)}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 64 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Bids</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{c.bids.length}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 78 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Ends in</div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>⏱ {fmtLeft(left)}</div>
                  </div>
                  <div onClick={() => td.open(c.id)} style={{ flex: 'none', textAlign: 'center', fontSize: 13, fontWeight: 800, padding: '11px 16px', border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer', background: '#fff' }}>View listing</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '54px 24px', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16 }}>
            <div style={{ fontSize: 42 }}>🔨</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, marginTop: 10 }}>You&apos;re not selling anything yet</div>
            <div style={{ fontSize: 13.5, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 6 }}>Turn your spare cards into cash — auctions take two minutes to set up.</div>
            <div onClick={td.goSell} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '13px 24px', background: '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>List a card</div>
          </div>
        )}
      </>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 36, letterSpacing: '-.02em', margin: 0 }}>My bids</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 6, fontWeight: 500 }}>Every lot you&apos;re chasing — and everything you&apos;re selling.</div>

      <div style={{ display: 'inline-flex', border: `3px solid ${INK}`, borderRadius: 11, overflow: 'hidden', margin: '20px 0 24px', boxShadow: `3px 3px 0 ${INK}` }}>
        <div onClick={() => td.setMyBidsTab('bidding')} style={{ fontSize: 13.5, fontWeight: 800, padding: '11px 24px', cursor: 'pointer', background: st.myBidsTab === 'bidding' ? INK : '#fff', color: st.myBidsTab === 'bidding' ? '#fff' : INK, borderRight: `3px solid ${INK}` }}>Bidding</div>
        <div onClick={() => td.setMyBidsTab('selling')} style={{ fontSize: 13.5, fontWeight: 800, padding: '11px 24px', cursor: 'pointer', background: st.myBidsTab === 'selling' ? INK : '#fff', color: st.myBidsTab === 'selling' ? '#fff' : INK }}>Selling</div>
      </div>

      {st.myBidsTab === 'bidding' && renderBidding(involved, watchList, winningCount, outbidCount, statusMeta)}
      {st.myBidsTab === 'selling' && renderSelling(owned, liveCount)}
    </div>
  );
}

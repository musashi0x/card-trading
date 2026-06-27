'use client';

import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { MY_CARDS, type TradeItem } from '@/components/topdeck/panels';
import { money, rarityMeta, rarityArt, type TopCard } from '@/components/topdeck/lib';
import { INK, DISPLAY } from '@/components/topdeck/theme';

// ===== TRADE =====
/** Resolve the live "you get" pool (open listings the user doesn't own). */
function tradeGetPool(cards: TopCard[]): TradeItem[] {
  return cards
    .filter((c) => !c.mine)
    .map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, value: c.currentBid, grade: c.grade, seller: c.seller }));
}

function tradeRow(item: TradeItem, side: 'give' | 'get', removeTradeCard: (side: 'give' | 'get', id: string) => void) {
  const rm = rarityMeta(item.rarity);
  return (
    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: side === 'give' ? '#fff7ec' : '#f3f7ff', border: `2.5px solid ${INK}`, borderRadius: 11, padding: '9px 11px' }}>
      <div style={{ position: 'relative', width: 48, height: 48, flex: 'none', borderRadius: 9, border: `2.5px solid ${INK}`, background: rarityArt(item.rarity) }}>
        <div style={{ position: 'absolute', bottom: 3, left: 3, fontSize: 7, fontWeight: 800, padding: '1.5px 5px', borderRadius: 4, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.2 }}>{item.name}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>{item.grade}{item.seller ? ' · ' + item.seller : ''}</div>
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 14 }}>{money(item.value)}</div>
      <div onClick={() => removeTradeCard(side, item.id)} style={{ width: 26, height: 26, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, border: `2px solid ${INK}`, background: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>✕</div>
    </div>
  );
}

export default function TradePage() {
  const td = useTopDeck();
  const st = td.state;

  function renderTrade() {
    const tr = st.trade;
    const myById = Object.fromEntries(MY_CARDS.map((c) => [c.id, c]));
    const getById = Object.fromEntries(tradeGetPool(st.cards).map((c) => [c.id, c]));
    const giveItems: TradeItem[] = tr.give.map((id) => myById[id]).filter(Boolean) as TradeItem[];
    const getItems: TradeItem[] = tr.get.map((id) => getById[id]).filter(Boolean) as TradeItem[];
    const cashN = Number(tr.cash) || 0;
    const giveVal = giveItems.reduce((a, c) => a + c.value, 0) + cashN;
    const getVal = getItems.reduce((a, c) => a + c.value, 0);
    const diff = giveVal - getVal;
    const tot = giveVal + getVal;
    const meter = tot > 0 ? Math.round((giveVal / tot) * 100) : 50;
    const fair = getVal > 0 && Math.abs(diff) <= Math.max(50, getVal * 0.05);
    const fairLabel = tot === 0 ? 'Add cards to both sides to start'
      : fair ? 'Fair trade — nicely balanced ✓'
        : diff > 0 ? 'Your side is ' + money(diff) + ' richer'
          : "You're asking for " + money(-diff) + ' more';
    const canSend = giveItems.length > 0 && getItems.length > 0;

    const side = (
      title: string, headBg: string, count: number, items: TradeItem[], sideKey: 'give' | 'get',
      emptyText: string, onAdd: () => void, footLabel: string, footVal: number, footBg: string,
    ) => (
      <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: headBg, borderBottom: `3px solid ${INK}` }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{title}</div>
          <div style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 7, background: INK, color: '#fff' }}>{count}</div>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 140 }}>
          {items.map((it) => tradeRow(it, sideKey, td.removeTradeCard))}
          {items.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.45)', padding: 14 }}>{emptyText}</div>
          )}
          <div onClick={onAdd} style={{ textAlign: 'center', fontSize: 13, fontWeight: 800, padding: 11, border: `2.5px dashed ${INK}`, borderRadius: 11, cursor: 'pointer', background: '#fff', color: INK }}>+ Add a card</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: `2.5px solid ${INK}`, background: footBg }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>{footLabel}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17 }}>{money(footVal)}</span>
        </div>
      </div>
    );

    return (
      <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#2d5bff', letterSpacing: '.04em', marginBottom: 6 }}>
          <span style={{ fontSize: 14 }}>⇄</span>PEER-TO-PEER
        </div>
        <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>Trade cards</h1>
        <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 8, fontWeight: 500 }}>Build a straight swap — any collector who owns these cards can accept your offer.</div>

        <div className="stack" style={{ display: 'grid', gridTemplateColumns: '1fr 54px 1fr', gap: 14, alignItems: 'start', marginTop: 26 }}>
          {side('You give', '#ffd84d', giveItems.length, giveItems, 'give', 'Add cards from your collection.', () => td.openTradePicker('give'), 'Your side incl. cash', giveVal, '#fff7ec')}
          <div style={{ alignSelf: 'center', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', border: `3px solid ${INK}`, background: '#2d5bff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: `3px 3px 0 ${INK}` }}>⇄</div>
          </div>
          {side('You get', '#cfe0ff', getItems.length, getItems, 'get', 'Add cards you want from the market.', () => td.openTradePicker('get'), 'Their side', getVal, '#f3f7ff')}
        </div>

        {/* balance + cash */}
        <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, padding: '20px 22px', marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17 }}>Trade balance</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, padding: '6px 13px', borderRadius: 9, border: `2.5px solid ${INK}`, background: tot === 0 ? '#fff' : fair ? '#bff3d4' : '#ffd1cc', color: tot === 0 ? 'rgba(26,19,5,.5)' : fair ? '#0a5e34' : '#a3160a' }}>{fairLabel}</div>
          </div>
          <div style={{ position: 'relative', height: 16, border: `2.5px solid ${INK}`, borderRadius: 999, overflow: 'hidden', background: '#fff', marginTop: 16 }}>
            <div style={{ width: meter + '%', height: '100%', background: '#2d5bff', transition: 'width .2s' }} />
            <div style={{ position: 'absolute', top: -4, left: '50%', width: 3, height: 24, background: INK, transform: 'translateX(-50%)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'rgba(26,19,5,.5)', marginTop: 7 }}>
            <span>You give</span><span>balanced</span><span>You get</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 18, paddingTop: 16, borderTop: '1.5px solid rgba(26,19,5,.12)' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em' }}>ADD CASH TO YOUR SIDE</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>Sweeten the deal to balance the value.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 11, padding: '2px 15px', width: 180 }}>
              <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19 }}>$</span>
              <input type="number" value={tr.cash} onChange={(e) => td.setTradeCash(e.target.value)} placeholder="0" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, padding: '10px 6px', width: '100%', minWidth: 0 }} />
            </div>
          </div>
        </div>

        {/* actions */}
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <div onClick={canSend ? td.sendTrade : undefined} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 30px', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: canSend ? 'pointer' : 'not-allowed', background: canSend ? '#13c06a' : '#e7ddc8', color: canSend ? '#fff' : 'rgba(26,19,5,.4)' }}>⇄ Post trade offer</div>
          <div onClick={td.resetTrade} style={{ fontWeight: 800, fontSize: 15, padding: '14px 22px', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer', background: '#fff' }}>Clear</div>
        </div>
      </div>
    );
  }

  function renderTradeSent() {
    const tr = st.trade;
    const myById = Object.fromEntries(MY_CARDS.map((c) => [c.id, c]));
    const getById = Object.fromEntries(tradeGetPool(st.cards).map((c) => [c.id, c]));
    const cashN = Number(tr.cash) || 0;
    const giveVal = tr.give.reduce((a, id) => a + (myById[id]?.value ?? 0), 0) + cashN;
    const getVal = tr.get.reduce((a, id) => a + (getById[id]?.value ?? 0), 0);

    return (
      <div className="m-pad" style={{ maxWidth: 560, margin: '30px auto 0', padding: '0 32px 90px', textAlign: 'center' }}>
        <div style={{ fontSize: 56 }}>🤝</div>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, letterSpacing: '-.02em', margin: '10px 0 0' }}>Trade offer posted!</h1>
        <div style={{ fontSize: 14.5, color: 'rgba(26,19,5,.6)', fontWeight: 500, marginTop: 8 }}>We&apos;ll notify you the moment a collector who owns those cards accepts. You can track it under My bids.</div>

        <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, padding: '20px 22px', marginTop: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1 }}>{tr.give.length}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 4 }}>You give · {money(giveVal)}</div>
          </div>
          <div style={{ width: 44, height: 44, borderRadius: '50%', border: `3px solid ${INK}`, background: '#2d5bff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flex: 'none' }}>⇄</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1 }}>{tr.get.length}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 4 }}>You get · {money(getVal)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 26 }}>
          <div onClick={() => { td.resetTrade(); td.goHome(); }} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 26px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Back to auctions</div>
          <div onClick={td.resetTrade} style={{ fontWeight: 800, fontSize: 15, padding: '14px 24px', background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer' }}>Build another</div>
        </div>
      </div>
    );
  }

  function renderTradePicker() {
    const tr = st.trade;
    const pool: TradeItem[] =
      tr.picker === 'give' ? MY_CARDS.filter((c) => !tr.give.includes(c.id))
        : tr.picker === 'get' ? tradeGetPool(st.cards).filter((c) => !tr.get.includes(c.id))
          : [];
    const title = tr.picker === 'give' ? "Pick a card you'll give" : 'Pick a card you want';

    return (
      <div onClick={td.closeTradePicker} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(26,19,5,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'modalIn .15s ease both' }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: '#fff7ec', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `8px 8px 0 ${INK}`, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: `3px solid ${INK}`, background: '#ffd84d' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19 }}>{title}</div>
            <div onClick={td.closeTradePicker} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `2.5px solid ${INK}`, background: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>✕</div>
          </div>
          <div className="stack" style={{ padding: '18px 22px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
            {pool.map((c) => {
              const rm = rarityMeta(c.rarity);
              return (
                <div key={c.id} onClick={() => td.addTradeCard(tr.picker as 'give' | 'get', c.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 12, padding: '10px 12px', cursor: 'pointer', boxShadow: `2px 2px 0 ${INK}` }}>
                  <div style={{ position: 'relative', width: 50, height: 50, flex: 'none', borderRadius: 9, border: `2.5px solid ${INK}`, background: rarityArt(c.rarity) }}>
                    <div style={{ position: 'absolute', bottom: 3, left: 3, fontSize: 7, fontWeight: 800, padding: '1.5px 5px', borderRadius: 4, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.2 }}>{c.name}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>{c.grade}{c.seller ? ' · ' + c.seller : ''}</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, marginTop: 4 }}>{money(c.value)}</div>
                  </div>
                  <div style={{ width: 28, height: 28, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `2px solid ${INK}`, background: '#13c06a', color: '#fff', fontSize: 16, fontWeight: 800 }}>+</div>
                </div>
              );
            })}
            {pool.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 30, fontSize: 13.5, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>Every card is already in your trade.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {!st.trade.sent && renderTrade()}
      {st.trade.sent && renderTradeSent()}
      {st.trade.picker && renderTradePicker()}
    </>
  );
}

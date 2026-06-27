'use client';

import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { INK, DISPLAY } from '@/components/topdeck/theme';
import { money, fmtLeft, rarityArt, mapRarity } from '@/components/topdeck/lib';
import type { OrderWithCard } from '@/lib/api';

function orderStatusStyle(status: OrderWithCard['status']): { bg: string; fg: string; label: string } {
  switch (status) {
    case 'funded':
      return { bg: '#ffd84d', fg: INK, label: 'FUNDED · AWAITING SHIPMENT' };
    case 'shipped':
      return { bg: '#2d5bff', fg: '#fff', label: 'SHIPPED · IN TRANSIT' };
    case 'disputed':
      return { bg: '#ff4d3d', fg: '#fff', label: 'DISPUTED' };
    case 'released':
      return { bg: '#13c06a', fg: '#fff', label: 'RELEASED · COMPLETE' };
    case 'refunded':
      return { bg: '#94a0b3', fg: INK, label: 'REFUNDED' };
  }
}

function renderOrderCard(o: OrderWithCard, address: string | null, td: ReturnType<typeof useTopDeck>) {
  const st = td.state;
  const badge = orderStatusStyle(o.status);
  const role = address && o.seller === address ? 'seller' : 'buyer';
  const busy = st.orderBusy === o.id;
  const active = o.status === 'funded' || o.status === 'shipped';
  const deadlineMs = o.confirmDeadline ? o.confirmDeadline * 1000 : 0;
  const overdue = deadlineMs > 0 && deadlineMs <= st.now;
  const classic = td.wallet.walletKind === 'classic';

  const btn = (label: string, onClick: () => void, bg: string, fg = '#fff') => (
    <div
      onClick={() => { if (!busy) onClick(); }}
      style={{
        fontFamily: DISPLAY, fontWeight: 800, fontSize: 13.5, padding: '10px 14px', textAlign: 'center',
        background: busy ? '#cfc8b8' : bg, color: fg, border: `2.5px solid ${INK}`, borderRadius: 10,
        boxShadow: `2px 2px 0 ${INK}`, cursor: busy ? 'default' : 'pointer',
      }}
    >
      {busy ? '…' : label}
    </div>
  );

  return (
    <div key={o.id} style={{ display: 'flex', gap: 16, background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, padding: 16, boxShadow: `4px 4px 0 ${INK}` }}>
      <div style={{ width: 72, height: 96, flex: 'none', borderRadius: 10, border: `2.5px solid ${INK}`, background: o.card.imageUrl ? `center/cover no-repeat url("${o.card.imageUrl}")` : rarityArt(mapRarity(o.card.rarity)) }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{o.card.name}</div>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, padding: '4px 8px', borderRadius: 999, background: badge.bg, color: badge.fg, border: `2px solid ${INK}` }}>{badge.label}</div>
        </div>
        <div style={{ color: '#5c5443', fontSize: 13, margin: '4px 0 10px' }}>
          {money(Number(o.amountUsdc))} · You're the {role}
          {active && deadlineMs > 0 && (
            <> · {overdue ? 'confirmation window elapsed' : `confirm window: ${fmtLeft(deadlineMs - st.now)} left`}</>
          )}
          {o.trackingRef && <> · tracking {o.trackingRef}</>}
        </div>

        {/* Role-based actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {!st.ordersArbiter && role === 'buyer' && active &&
            btn('✓ Confirm receipt', () => void td.doOrderAction('confirm_receipt', o), '#13c06a')}
          {!st.ordersArbiter && role === 'seller' && o.status === 'funded' &&
            btn('📦 Mark shipped', () => void td.doOrderAction('mark_shipped', o), '#2d5bff')}
          {!st.ordersArbiter && active &&
            btn('⚠ Open dispute', () => void td.doOrderAction('dispute', o), '#fff', INK)}
          {!st.ordersArbiter && active && overdue && classic &&
            btn('⏱ Claim (timeout)', () => void td.doOrderAction('claim_timeout', o), '#e0a92e', INK)}

          {/* Arbiter view */}
          {st.ordersArbiter && o.status === 'disputed' && (
            <>
              {btn('↩ Refund buyer', () => void td.resolveDispute(o, true), '#ff4d3d')}
              {btn('→ Release seller', () => void td.resolveDispute(o, false), '#13c06a')}
            </>
          )}

          {(o.status === 'released' || o.status === 'refunded') && o.settleTxHash && (
            <a href={td.explorerTx(o.settleTxHash)} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 800, color: '#2d5bff', alignSelf: 'center' }}>
              View settlement ↗
            </a>
          )}
          {o.status === 'disputed' && !st.ordersArbiter && (
            <div style={{ fontSize: 13, color: '#5c5443', alignSelf: 'center' }}>Awaiting arbiter decision…</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const td = useTopDeck();
  const st = td.state;
  const { address } = td.wallet;
  const { data: orders, disputed, loading, error } = td.orders;
  const tab = (label: string, on: boolean, onClick: () => void, count?: number) => (
    <div
      onClick={onClick}
      style={{
        fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '9px 16px', cursor: 'pointer',
        background: on ? INK : '#fff', color: on ? '#fff' : INK, border: `2.5px solid ${INK}`,
        borderRadius: 9, boxShadow: on ? `2px 2px 0 ${INK}` : 'none',
      }}
    >
      {label}{count != null && count > 0 ? ` · ${count}` : ''}
    </div>
  );
  const list = st.ordersArbiter ? disputed : orders;
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 20px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, flex: 1 }}>Escrow orders</div>
        <div onClick={() => td.orders.refresh()} style={{ fontSize: 13, fontWeight: 800, padding: '8px 13px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, cursor: 'pointer' }}>↻ Refresh</div>
      </div>
      <p style={{ color: '#5c5443', fontSize: 14, margin: '0 0 18px', maxWidth: 620 }}>
        Physical cards settle through a blockchain escrow: your funds are held by the contract
        until you confirm the card arrived. If something goes wrong, open a dispute and the
        arbiter decides — neither side can take the money and run.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {tab('My orders', !st.ordersArbiter, () => td.setOrdersArbiter(false))}
        {tab('Arbiter · disputes', st.ordersArbiter, () => td.setOrdersArbiter(true), disputed.length)}
      </div>

      {loading && <div style={{ color: '#5c5443', fontSize: 14 }}>Loading orders…</div>}
      {error && !loading && (
        <div style={{ color: '#b3261e', fontSize: 14, fontWeight: 700 }}>{error}</div>
      )}
      {!loading && !error && list.length === 0 && (
        <div style={{ border: `2.5px dashed ${INK}`, borderRadius: 14, padding: 40, textAlign: 'center', color: '#5c5443' }}>
          {st.ordersArbiter ? 'No open disputes.' : 'No escrow orders yet. Buy a physical listing to start one.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {list.map((o) => renderOrderCard(o, address, td))}
      </div>
    </div>
  );
}

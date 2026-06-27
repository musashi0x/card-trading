'use client';

import { useState } from 'react';
import type { Card, TradeProposal } from '@cardmkt/shared';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { INK, DISPLAY } from '@/components/topdeck/theme';
import { shorten } from '@/components/topdeck/lib';
import { useTrades, useTradeProposals } from '@/lib/queries';
import type { TradeWithNet } from '@/lib/api';

/** "$1,234.56" with cents — trades carry 7-dp USDC strings; show 2 for readability. */
function usd(v: string): string {
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function settledWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderTradeRow(t: TradeWithNet, address: string | null, explorerTx: (h: string) => string) {
  const youBuyer = !!address && t.buyer === address;
  const youSeller = !!address && t.seller === address;
  const cell = (label: string, value: string, accent?: string) => (
    <div style={{ minWidth: 92 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: 'rgba(26,19,5,.5)' }}>{label}</div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: accent ?? INK }}>{value}</div>
    </div>
  );
  return (
    <div key={t.id} style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, padding: '14px 16px', boxShadow: `4px 4px 0 ${INK}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: '#5c5443' }}>
          <span style={{ fontWeight: 800, color: INK }}>{shorten(t.seller)}</span>
          {youSeller && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#0a5e34' }}> · you</span>}
          <span style={{ margin: '0 6px' }}>→</span>
          <span style={{ fontWeight: 800, color: INK }}>{shorten(t.buyer)}</span>
          {youBuyer && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#0a5e34' }}> · you</span>}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(26,19,5,.55)' }}>{settledWhen(t.settledAt)}</div>
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {cell('PRICE', usd(t.priceUsdc))}
        {cell('PLATFORM FEE', usd(t.feeUsdc))}
        {cell('CREATOR ROYALTY', usd(t.royaltyUsdc))}
        {cell('SELLER NET', usd(t.sellerNetUsdc), '#0a5e34')}
        <a
          href={explorerTx(t.settleTxHash)}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#2d5bff' }}
        >
          View settlement ↗
        </a>
      </div>
    </div>
  );
}

function cardNames(cards: Card[] | undefined, ids: string[]): string {
  if (cards && cards.length) return cards.map((c) => c.name).join(', ');
  return ids.length ? `${ids.length} card${ids.length > 1 ? 's' : ''}` : '—';
}

/** A settled barter swap: give-side cards ⇄ get-side cards, with sweetener + fee. */
function renderSwapRow(p: TradeProposal, address: string | null, explorerTx: (h: string) => string) {
  const youProposer = !!address && p.proposer === address;
  const youCounter = !!address && p.counterparty === address;
  const cash = Number(p.cashUsdc) || 0;
  return (
    <div key={p.id} style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, padding: '14px 16px', boxShadow: `4px 4px 0 ${INK}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: '#5c5443' }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#2d5bff', marginRight: 8 }}>SWAP</span>
          <span style={{ fontWeight: 800, color: INK }}>{shorten(p.proposer)}</span>
          {youProposer && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#0a5e34' }}> · you</span>}
          <span style={{ margin: '0 6px' }}>⇄</span>
          <span style={{ fontWeight: 800, color: INK }}>{shorten(p.counterparty)}</span>
          {youCounter && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#0a5e34' }}> · you</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 140 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>GAVE</div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{cardNames(p.giveCards, p.giveCardIds)}{cash > 0 ? ` + $${cash}` : ''}</div>
        </div>
        <div style={{ fontSize: 18 }}>⇄</div>
        <div style={{ minWidth: 140 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>GOT</div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{cardNames(p.getCards, p.getCardIds)}</div>
        </div>
        {cash > 0 && (
          <div style={{ minWidth: 92 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>PLATFORM FEE</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15 }}>{usd(p.feeUsdc)}</div>
          </div>
        )}
        {p.swapTxHash && (
          <a href={explorerTx(p.swapTxHash)} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#2d5bff' }}>
            View swap ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default function TradesPage() {
  const td = useTopDeck();
  const { address } = td.wallet;
  const [myOnly, setMyOnly] = useState(false);
  const filterAccount = myOnly && address ? address : undefined;
  const { data: trades, isLoading, isError, error } = useTrades(filterAccount);
  // Accepted barter swaps for the connected wallet, with full card metadata.
  const { data: swaps = [] } = useTradeProposals(address, 'accepted');

  const tab = (label: string, on: boolean, onClick: () => void) => (
    <div
      onClick={onClick}
      style={{
        fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '9px 16px', cursor: 'pointer',
        background: on ? INK : '#fff', color: on ? '#fff' : INK, border: `2.5px solid ${INK}`,
        borderRadius: 9, boxShadow: on ? `2px 2px 0 ${INK}` : 'none',
      }}
    >
      {label}
    </div>
  );

  // Swap settlements are surfaced as rich barter rows (below), so keep them out
  // of the cash-trade list to avoid showing each swap twice.
  const list = (trades ?? []).filter((t) => !t.swapTxHash);
  const nothingToShow = list.length === 0 && swaps.length === 0;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 20px 80px' }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, marginBottom: 8 }}>Trade history</div>
      <p style={{ color: '#5c5443', fontSize: 14, margin: '0 0 18px', maxWidth: 640 }}>
        Every settled sale on-chain, with the full split — what the buyer paid, the platform fee, the
        creator royalty, and what the seller actually netted. Each row links to the settlement
        transaction on the block explorer.
      </p>

      {address && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {tab('All trades', !myOnly, () => setMyOnly(false))}
          {tab('My trades', myOnly, () => setMyOnly(true))}
        </div>
      )}

      {isLoading && <div style={{ color: '#5c5443', fontSize: 14 }}>Loading trade history…</div>}
      {isError && !isLoading && (
        <div style={{ color: '#b3261e', fontSize: 14, fontWeight: 700 }}>
          {(error as Error)?.message ?? 'Could not load trade history.'}
        </div>
      )}
      {!isLoading && !isError && nothingToShow && (
        <div style={{ border: `2.5px dashed ${INK}`, borderRadius: 14, padding: 40, textAlign: 'center', color: '#5c5443' }}>
          {myOnly ? "You haven't bought or sold anything yet." : 'No settled trades yet. They appear here once a sale clears on-chain.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {list.map((t) => renderTradeRow(t, address, td.explorerTx))}
      </div>

      {swaps.length > 0 && (
        <>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, margin: '26px 0 12px' }}>Barter swaps</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {swaps.map((p) => renderSwapRow(p, address, td.explorerTx))}
          </div>
        </>
      )}
    </div>
  );
}

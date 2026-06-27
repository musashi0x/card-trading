'use client';

/**
 * Trade inbox — incoming and outgoing barter proposals for the connected wallet
 * (tasks 7.2–7.6). Each proposal shows the give/get card breakdown, USDC
 * sweetener, status, expiry countdown, and the actions available to the viewer:
 * accept / decline / counter on incoming, cancel on outgoing. Settlement runs
 * through the wallet's build → sign → submit flow; the list polls so a settled
 * proposal updates shortly after it clears.
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Card, TradeProposal } from '@cardmkt/shared';
import { ApiRequestError, type SwapAction } from '@/lib/api';
import { useTradeProposals, invalidateTradeProposals } from '@/lib/queries';
import { explorerTx } from '@/lib/explorer';
import { useWallet } from '@/components/WalletProvider';
import { useTopDeck } from './TopDeckProvider';
import { INK, DISPLAY } from './theme';
import { shorten } from './lib';

const STATUS_META: Record<TradeProposal['status'], { label: string; bg: string; color: string }> = {
  proposed: { label: 'Pending', bg: '#ffe9a8', color: '#7a5b00' },
  accepted: { label: 'Accepted', bg: '#bff3d4', color: '#0a5e34' },
  declined: { label: 'Declined', bg: '#ffd1cc', color: '#a3160a' },
  cancelled: { label: 'Cancelled', bg: '#e7e1d3', color: '#5c5443' },
  expired: { label: 'Expired', bg: '#e7e1d3', color: '#5c5443' },
};

/** "2d 4h", "5h 12m", "12m", or "expired" until `iso`. */
function timeLeft(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function cardNames(cards: Card[] | undefined, ids: string[]): string {
  if (cards && cards.length) return cards.map((c) => c.name).join(', ');
  return ids.length ? `${ids.length} card${ids.length > 1 ? 's' : ''}` : '—';
}

function SidePill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, color: 'rgba(26,19,5,.5)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  );
}

export function TradeInbox({ onCounter }: { onCounter: (p: TradeProposal) => void }) {
  const { address, swapAction } = useWallet();
  const { showToast } = useTopDeck();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'incoming' | 'outgoing'>('incoming');
  const [busy, setBusy] = useState<string | null>(null);

  const { data: proposals = [], isLoading } = useTradeProposals(address);
  const now = Date.now();

  const { incoming, outgoing } = useMemo(() => {
    const inc: TradeProposal[] = [];
    const out: TradeProposal[] = [];
    for (const p of proposals) {
      if (p.counterparty === address) inc.push(p);
      if (p.proposer === address) out.push(p);
    }
    return { incoming: inc, outgoing: out };
  }, [proposals, address]);

  async function act(p: TradeProposal, action: SwapAction) {
    setBusy(p.id);
    try {
      await swapAction(p.id, action);
      invalidateTradeProposals(queryClient, address);
      showToast(
        action === 'accept' ? 'Swap complete — cards exchanged 🤝' : `Proposal ${action}ed`,
        'win',
      );
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : (err as Error).message;
      showToast(msg, 'outbid');
    } finally {
      setBusy(null);
    }
  }

  if (!address) {
    return (
      <div style={{ border: `2.5px dashed ${INK}`, borderRadius: 14, padding: 32, textAlign: 'center', color: '#5c5443', fontWeight: 600 }}>
        Connect your wallet to see incoming and outgoing trade proposals.
      </div>
    );
  }

  const list = tab === 'incoming' ? incoming : outgoing;

  const tabBtn = (key: 'incoming' | 'outgoing', label: string, count: number) => (
    <div
      onClick={() => setTab(key)}
      style={{
        fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '9px 16px', cursor: 'pointer',
        background: tab === key ? INK : '#fff', color: tab === key ? '#fff' : INK,
        border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: tab === key ? `2px 2px 0 ${INK}` : 'none',
      }}
    >
      {label} {count > 0 && <span style={{ opacity: 0.7 }}>· {count}</span>}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        {tabBtn('incoming', 'Incoming', incoming.length)}
        {tabBtn('outgoing', 'Outgoing', outgoing.length)}
      </div>

      {isLoading && <div style={{ color: '#5c5443', fontSize: 14 }}>Loading proposals…</div>}
      {!isLoading && list.length === 0 && (
        <div style={{ border: `2.5px dashed ${INK}`, borderRadius: 14, padding: 36, textAlign: 'center', color: '#5c5443', fontWeight: 600 }}>
          {tab === 'incoming'
            ? 'No incoming proposals. When someone offers you a trade, it shows up here.'
            : 'No outgoing proposals yet. Build one above to get started.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {list.map((p) => {
          const meta = STATUS_META[p.status];
          const isIncoming = tab === 'incoming';
          const cash = Number(p.cashUsdc) || 0;
          const pending = p.status === 'proposed';
          const expired = p.status === 'expired';
          const working = busy === p.id;
          // The proposer always gives `giveCards` and gets `getCards`; relabel for
          // the viewer so "You give / You get" reads correctly from their side.
          const youGive = isIncoming
            ? { label: 'You give', value: cardNames(p.getCards, p.getCardIds) }
            : { label: 'You give', value: cardNames(p.giveCards, p.giveCardIds) };
          const youGet = isIncoming
            ? { label: 'You get', value: cardNames(p.giveCards, p.giveCardIds) }
            : { label: 'You get', value: cardNames(p.getCards, p.getCardIds) };
          const counter = isIncoming ? p.proposer : p.counterparty;

          return (
            <div key={p.id} style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, padding: '14px 16px', boxShadow: `4px 4px 0 ${INK}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: '#5c5443' }}>
                  {isIncoming ? 'From ' : 'To '}
                  <span style={{ fontWeight: 800, color: INK }}>{shorten(counter)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {pending && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#5c5443' }}>{timeLeft(p.expiresAt, now)} left</span>}
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 7, background: meta.bg, color: meta.color }}>{meta.label}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <SidePill label={youGive.label} value={youGive.value + (isIncoming && cash > 0 ? '' : !isIncoming && cash > 0 ? ` + $${cash}` : '')} />
                <div style={{ fontSize: 18, flex: 'none' }}>⇄</div>
                <SidePill label={youGet.label} value={youGet.value + (isIncoming && cash > 0 ? ` + $${cash}` : '')} />
              </div>

              {(pending || expired) && (
                <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  {isIncoming && pending && (
                    <>
                      <button disabled={working} onClick={() => act(p, 'accept')} style={btn('#13c06a', '#fff', working)}>
                        {working ? '…' : 'Accept'}
                      </button>
                      <button disabled={working} onClick={() => act(p, 'decline')} style={btn('#fff', INK, working)}>Decline</button>
                      <button disabled={working} onClick={() => onCounter(p)} style={btn('#fff', INK, working)}>Counter</button>
                    </>
                  )}
                  {!isIncoming && (
                    <button disabled={working} onClick={() => act(p, 'cancel')} style={btn('#fff', INK, working)}>
                      {working ? '…' : expired ? 'Reclaim cards' : 'Cancel'}
                    </button>
                  )}
                </div>
              )}

              {p.status === 'accepted' && p.swapTxHash && (
                <a href={explorerTx(p.swapTxHash)} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 12, fontSize: 13, fontWeight: 800, color: '#2d5bff' }}>
                  View swap ↗
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function btn(bg: string, color: string, disabled: boolean): React.CSSProperties {
  return {
    fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '10px 18px',
    border: `2.5px solid ${INK}`, borderRadius: 10, background: bg, color,
    boxShadow: `2px 2px 0 ${INK}`, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}

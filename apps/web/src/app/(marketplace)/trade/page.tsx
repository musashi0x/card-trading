'use client';

/**
 * Barter trade — propose a peer-to-peer card swap and manage the inbox
 * (tasks 7.1, 7.7). The give side is the connected wallet's real on-chain
 * holdings (`GET /api/cards?owner=`); the get side is the live open listings.
 * The proposer targets a specific counterparty address, optionally sweetens the
 * deal with USDC, and submits a real `propose_swap` that locks the give-side
 * cards into contract custody. The Inbox tab shows incoming/outgoing proposals.
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Card, Listing, TradeProposal } from '@cardmkt/shared';
import { ApiRequestError } from '@/lib/api';
import { useCards, useListings, invalidateTradeProposals } from '@/lib/queries';
import { useWallet } from '@/components/WalletProvider';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { TradeInbox } from '@/components/topdeck/TradeInbox';
import { money, rarityMeta, rarityArt, mapRarity } from '@/components/topdeck/lib';
import { INK, DISPLAY } from '@/components/topdeck/theme';

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

/** A selectable card tile for either side of the builder. */
function CardTile({
  name,
  rarity,
  sub,
  selected,
  onClick,
}: {
  name: string;
  rarity: string;
  sub?: string;
  selected: boolean;
  onClick: () => void;
}) {
  const r = mapRarity(rarity);
  const rm = rarityMeta(r);
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, background: selected ? '#eafaf0' : '#fff',
        border: `2.5px solid ${selected ? '#13c06a' : INK}`, borderRadius: 12, padding: '9px 11px',
        cursor: 'pointer', boxShadow: selected ? `2px 2px 0 #13c06a` : `2px 2px 0 ${INK}`,
      }}
    >
      <div style={{ position: 'relative', width: 46, height: 46, flex: 'none', borderRadius: 9, border: `2.5px solid ${INK}`, background: rarityArt(r) }}>
        <div style={{ position: 'absolute', bottom: 3, left: 3, fontSize: 7, fontWeight: 800, padding: '1.5px 5px', borderRadius: 4, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        {sub && <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ width: 26, height: 26, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, border: `2px solid ${INK}`, background: selected ? '#13c06a' : '#fff', color: selected ? '#fff' : INK, fontSize: 15, fontWeight: 800 }}>
        {selected ? '✓' : '+'}
      </div>
    </div>
  );
}

function Panel({ title, headBg, count, children }: { title: string; headBg: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', background: headBg, borderBottom: `3px solid ${INK}` }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{title}</div>
        <div style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 7, background: INK, color: '#fff' }}>{count}</div>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto', minHeight: 120 }}>
        {children}
      </div>
    </div>
  );
}

export default function TradePage() {
  const { address, proposeSwap, swapAction } = useWallet();
  const { showToast } = useTopDeck();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'propose' | 'inbox'>('propose');
  const [counterparty, setCounterparty] = useState('');
  const [give, setGive] = useState<Set<string>>(new Set());
  const [get, setGet] = useState<Set<string>>(new Set());
  const [cash, setCash] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: myCards = [], isLoading: cardsLoading } = useCards(address);
  const { data: listings = [] } = useListings();

  // The get side draws from live open listings the user doesn't already own.
  const getPool = useMemo<Listing[]>(
    () => listings.filter((l) => l.card && l.seller !== address),
    [listings, address],
  );

  function toggle(set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setCounterparty('');
    setGive(new Set());
    setGet(new Set());
    setCash('');
  }

  const counterpartyValid = STELLAR_ADDRESS.test(counterparty.trim());
  const canSubmit = !!address && counterpartyValid && give.size > 0 && !submitting;

  async function submit() {
    if (!address) {
      showToast('Connect your wallet to propose a trade', 'outbid');
      return;
    }
    if (!counterpartyValid) {
      showToast('Enter a valid counterparty address (G… or C…)', 'outbid');
      return;
    }
    if (counterparty.trim() === address) {
      showToast('You cannot propose a trade to yourself', 'outbid');
      return;
    }
    if (give.size === 0) {
      showToast('Pick at least one card to give', 'outbid');
      return;
    }
    setSubmitting(true);
    try {
      await proposeSwap({
        counterparty: counterparty.trim(),
        giveCardIds: [...give],
        getCardIds: [...get],
        cashUsdc: Number(cash) > 0 ? String(Number(cash)) : undefined,
      });
      invalidateTradeProposals(queryClient, address);
      showToast('Trade proposed — cards locked in escrow ⇄', 'win');
      reset();
      setView('inbox');
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : (err as Error).message;
      showToast(msg, 'outbid');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Counter an incoming proposal: decline the original, then pre-populate the
   * builder with the terms reversed (their cards become your get side, and the
   * cards they wanted become your give side) for the user to edit and submit.
   */
  async function onCounter(p: TradeProposal) {
    try {
      await swapAction(p.id, 'decline');
      invalidateTradeProposals(queryClient, address);
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : (err as Error).message;
      showToast(`Could not decline the original: ${msg}`, 'outbid');
      return;
    }
    setCounterparty(p.proposer);
    // What you would give back is what they originally asked for from you.
    setGive(new Set(p.getCardIds));
    setGet(new Set(p.giveCardIds));
    setCash('');
    setView('propose');
    showToast('Original declined — edit your counter-offer below', 'win');
  }

  const cashN = Number(cash) || 0;

  const viewTab = (key: 'propose' | 'inbox', label: string) => (
    <div
      onClick={() => setView(key)}
      style={{
        fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '10px 18px', cursor: 'pointer',
        background: view === key ? INK : '#fff', color: view === key ? '#fff' : INK,
        border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: view === key ? `2px 2px 0 ${INK}` : 'none',
      }}
    >
      {label}
    </div>
  );

  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#2d5bff', letterSpacing: '.04em', marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>⇄</span>PEER-TO-PEER
      </div>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>Trade cards</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 8, fontWeight: 500 }}>
        Offer a specific collector a card-for-card swap, sweetened with USDC if you like. Their cards and yours move atomically on-chain the moment they accept.
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 22, marginBottom: 22 }}>
        {viewTab('propose', 'Propose a trade')}
        {viewTab('inbox', 'Trade inbox')}
      </div>

      {view === 'inbox' && <TradeInbox onCounter={onCounter} />}

      {view === 'propose' && (
        <>
          {/* counterparty */}
          <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, padding: '16px 20px', marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>COUNTERPARTY ADDRESS</div>
            <input
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder="G… or C… — the collector you want to trade with"
              spellCheck={false}
              style={{
                width: '100%', border: `2.5px solid ${counterparty && !counterpartyValid ? '#a3160a' : INK}`,
                borderRadius: 11, padding: '11px 14px', fontSize: 13.5, fontWeight: 600, outline: 'none', fontFamily: 'monospace',
              }}
            />
            {counterparty && !counterpartyValid && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#a3160a', marginTop: 6 }}>That doesn’t look like a Stellar address (G… or C…, 56 chars).</div>
            )}
          </div>

          <div className="stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
            <Panel title="You give" headBg="#ffd84d" count={give.size}>
              {!address && <Empty>Connect your wallet to load your cards.</Empty>}
              {address && cardsLoading && <Empty>Loading your cards…</Empty>}
              {address && !cardsLoading && myCards.length === 0 && <Empty>You don’t hold any cards yet.</Empty>}
              {myCards.map((c: Card) => (
                <CardTile key={c.id} name={c.name} rarity={c.rarity} sub={c.set || undefined} selected={give.has(c.id)} onClick={() => toggle(setGive, c.id)} />
              ))}
            </Panel>

            <Panel title="You get" headBg="#cfe0ff" count={get.size}>
              {getPool.length === 0 && <Empty>No open listings to request right now.</Empty>}
              {getPool.map((l) => (
                <CardTile
                  key={l.card!.id}
                  name={l.card!.name}
                  rarity={l.card!.rarity}
                  sub={`${money(Number(l.priceUsdc))} · ${l.seller.slice(0, 4)}…`}
                  selected={get.has(l.card!.id)}
                  onClick={() => toggle(setGet, l.card!.id)}
                />
              ))}
            </Panel>
          </div>

          {/* cash sweetener */}
          <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, padding: '18px 22px', marginTop: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em' }}>ADD A USDC SWEETENER</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>A one-way top-up from you to balance the deal (optional).</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 11, padding: '2px 15px', width: 180 }}>
              <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19 }}>$</span>
              <input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, padding: '10px 6px', width: '100%', minWidth: 0 }} />
            </div>
          </div>

          {cashN > 0 && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,19,5,.55)', marginTop: 8 }}>
              The platform fee applies to the {money(cashN)} sweetener; pure card-for-card swaps are fee-free.
            </div>
          )}

          {/* actions */}
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <div
              onClick={canSubmit ? submit : undefined}
              style={{
                fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 30px', border: `3px solid ${INK}`,
                borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: canSubmit ? 'pointer' : 'not-allowed',
                background: canSubmit ? '#13c06a' : '#e7ddc8', color: canSubmit ? '#fff' : 'rgba(26,19,5,.4)',
              }}
            >
              {submitting ? 'Proposing…' : '⇄ Propose trade'}
            </div>
            <div onClick={reset} style={{ fontWeight: 800, fontSize: 15, padding: '14px 22px', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer', background: '#fff' }}>Clear</div>
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.45)', padding: 14 }}>
      {children}
    </div>
  );
}

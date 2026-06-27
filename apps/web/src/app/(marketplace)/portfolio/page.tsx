'use client';

import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { INK, DISPLAY } from '@/components/topdeck/theme';
import { money, mapRarity, rarityMeta, rarityArt, type Rarity } from '@/components/topdeck/lib';
import { usePortfolio } from '@/lib/queries';

/**
 * Stacked-bar colors per rarity. Presentational (not data), so they live with the
 * page rather than in the API response (design Decision 5).
 */
const ALLOC_COLORS: Record<Rarity, string> = {
  legendary: '#e0a92e',
  epic: '#7c3aed',
  rare: '#2d5bff',
  common: '#13c06a',
};

const signPct = (p: number) => (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '%';

/** `YYYY-MM` → short month label (e.g. `Jun`). */
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
}

function ConnectPrompt({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '60px 32px 90px' }}>
      <div style={{ textAlign: 'center', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16, padding: '60px 40px' }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>Connect your wallet to view your portfolio</div>
        <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 8 }}>Your holdings are valued live against the market.</div>
        <div onClick={onConnect} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '12px 24px', background: INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Connect wallet</div>
      </div>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>Portfolio</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 8, fontWeight: 500 }}>Your collection, valued live against the market.</div>
      {children}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <PageShell>
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, marginTop: 24 }}>
        <div style={{ height: 230, background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `5px 5px 0 ${INK}`, opacity: 0.4 }} />
        <div style={{ height: 230, background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `5px 5px 0 ${INK}`, opacity: 0.4 }} />
      </div>
      <div style={{ marginTop: 18, fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.45)' }}>Loading your portfolio…</div>
    </PageShell>
  );
}

export default function PortfolioPage() {
  const td = useTopDeck();
  const { address } = td.wallet;
  const { data, isLoading, isError } = usePortfolio(address);

  // No wallet — prompt to connect and make no API call (the hook is disabled).
  if (!address) return <ConnectPrompt onConnect={td.wallet.connect} />;
  if (isLoading) return <LoadingSkeleton />;
  if (isError || !data) {
    return (
      <PageShell>
        <div style={{ marginTop: 24, background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16, padding: '40px 24px', textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'rgba(26,19,5,.6)' }}>
          Couldn’t load your portfolio. Check your connection and try again.
        </div>
      </PageShell>
    );
  }

  const { holdings, rarity, bestPerformer, history } = data;
  const totalVal = Number(data.totalValue);
  const totalCost = Number(data.totalCost);
  const gain = Number(data.unrealizedGain);
  const gainPct = data.unrealizedGainPct;

  // Wallet connected but holds nothing — honest empty state, totals at zero.
  if (holdings.length === 0) {
    return (
      <PageShell>
        <div style={{ marginTop: 24, background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16, padding: '54px 40px', textAlign: 'center' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>No cards held</div>
          <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 8 }}>Buy or mint a card and it’ll show up here, valued live. Total value: {money(0)}.</div>
        </div>
      </PageShell>
    );
  }

  const histVals = history.map((h) => Number(h.value));
  const histMax = Math.max(1, ...histVals);

  const alloc = rarity.map((a) => {
    const r = mapRarity(a.rarity);
    return {
      label: rarityMeta(r).label,
      color: ALLOC_COLORS[r],
      pct: Math.round(a.pct) + '%',
      width: a.pct + '%',
      valueFmt: money(Number(a.value)),
    };
  });

  // "In the red" counts only holdings with a known cost and a real market value.
  const losers = holdings.filter(
    (h) => h.costBasisKnown && h.valuedAt !== null && Number(h.value) < Number(h.costBasis),
  ).length;

  return (
    <PageShell>
      {/* value + chart */}
      <div className="stack" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, marginTop: 24, alignItems: 'stretch' }}>
        <div style={{ background: INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: '5px 5px 0 #ff4d3d', padding: 24, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)' }}>Total portfolio value</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 46, lineHeight: 1, marginTop: 6 }}>{money(totalVal)}</div>
          {gainPct != null && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 14, fontSize: 13.5, fontWeight: 800, padding: '7px 13px', borderRadius: 9, background: gain >= 0 ? '#13c06a' : '#ff4d3d', color: '#fff', border: '2.5px solid #fff', width: 'fit-content' }}>
              {(gain >= 0 ? '▲ ' : '▼ ') + '$' + Math.abs(gain).toLocaleString() + ' (' + signPct(gainPct) + ')'}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 26, marginTop: 22, paddingTop: 18, borderTop: '1.5px solid rgba(255,255,255,.18)' }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', fontWeight: 700 }}>Cost basis</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginTop: 3 }}>{money(totalCost)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', fontWeight: 700 }}>Cards held</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginTop: 3 }}>{holdings.length}</div>
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `5px 5px 0 ${INK}`, padding: '20px 22px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17 }}>Value over time</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Last 12 months</div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 6, paddingTop: 24, minHeight: 190 }}>
            {history.map((h, i) => (
              <div key={h.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', height: Math.round((Number(h.value) / histMax) * 150), background: i === history.length - 1 ? '#ff4d3d' : '#ffd84d', border: `2.5px solid ${INK}`, borderRadius: '7px 7px 0 0' }} />
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>{monthLabel(h.month)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* stat tiles */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
        <div style={{ flex: 1, minWidth: 150, background: '#bff3d4', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: gain >= 0 ? '#0a5e34' : '#a3160a' }}>{gainPct != null ? signPct(gainPct) : '—'}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0a5e34', marginTop: 5 }}>Unrealized return</div>
        </div>
        <div style={{ flex: 1.6, minWidth: 220, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>Top performer</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bestPerformer ? bestPerformer.name : '—'}</div>
          </div>
          {bestPerformer && (
            <div style={{ flex: 'none', fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, color: bestPerformer.returnPct >= 0 ? '#0a5e34' : '#a3160a', padding: '6px 12px', borderRadius: 9, background: '#e3f8ec', border: `2.5px solid ${INK}` }}>{signPct(bestPerformer.returnPct)}</div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 150, background: '#ffd1cc', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: '#a3160a' }}>{losers}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#a3160a', marginTop: 5 }}>Cards in the red</div>
        </div>
      </div>

      {/* allocation */}
      {alloc.length > 0 && (
        <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, padding: '20px 22px', marginTop: 18 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, marginBottom: 14 }}>Allocation by rarity</div>
          <div style={{ display: 'flex', height: 26, border: `3px solid ${INK}`, borderRadius: 9, overflow: 'hidden' }}>
            {alloc.map((a, i) => (
              <div key={a.label} style={{ width: a.width, background: a.color, borderRight: i === alloc.length - 1 ? 'none' : `2px solid ${INK}` }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 26px', marginTop: 15 }}>
            {alloc.map((a) => (
              <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 13, height: 13, borderRadius: 4, background: a.color, border: `2px solid ${INK}`, flex: 'none' }} />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{a.label}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>{a.pct} · {a.valueFmt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* holdings */}
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, margin: '30px 0 14px' }}>Holdings</div>
      <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', background: '#ffd84d', borderBottom: `3px solid ${INK}`, fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.65)' }}>
          <div style={{ width: 46 }} />
          <div style={{ flex: 1 }}>CARD</div>
          <div style={{ width: 90, textAlign: 'right' }}>COST</div>
          <div style={{ width: 90, textAlign: 'right' }}>VALUE</div>
          <div style={{ width: 120, textAlign: 'right' }}>RETURN</div>
        </div>
        {holdings.map((h) => {
          const r = mapRarity(h.rarity);
          const rm = rarityMeta(r);
          const value = Number(h.value);
          const cost = Number(h.costBasis);
          const priced = h.valuedAt !== null;
          // Return only when there's both a known cost and a real market value.
          const hasReturn = h.costBasisKnown && priced;
          const ch = value - cost;
          const p = cost > 0 ? (ch / cost) * 100 : 0;
          const up = ch >= 0;
          return (
            <div key={h.cardId} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: '1.5px solid rgba(26,19,5,.1)' }}>
              <div style={{ position: 'relative', width: 46, height: 46, flex: 'none', borderRadius: 10, border: `2.5px solid ${INK}`, background: h.imageUrl ? `center/cover no-repeat url("${h.imageUrl}")` : rarityArt(r) }}>
                <div style={{ position: 'absolute', bottom: 3, left: 3, fontSize: 7, fontWeight: 800, padding: '1.5px 5px', borderRadius: 4, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                {h.listed && <span style={{ flex: 'none', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5, background: '#cfe0ff', border: `1.5px solid ${INK}`, color: INK }}>LISTED</span>}
              </div>
              <div style={{ width: 90, textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>{h.costBasisKnown ? money(cost) : '—'}</div>
              <div style={{ width: 90, textAlign: 'right', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{priced ? money(value) : '—'}</div>
              <div style={{ width: 120, textAlign: 'right' }}>
                {hasReturn ? (
                  <>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: up ? '#0a5e34' : '#a3160a' }}>{signPct(p)}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: up ? '#0a5e34' : '#a3160a', marginTop: 1 }}>{(up ? '+$' : '−$') + Math.abs(ch).toLocaleString()}</div>
                  </>
                ) : (
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: 'rgba(26,19,5,.4)' }}>N/A</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}

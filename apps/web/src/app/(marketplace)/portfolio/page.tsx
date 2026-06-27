import { INK, DISPLAY } from '@/components/topdeck/theme';
import {
  PF_RAW,
  PF_HIST_VALS,
  PF_HIST_LABELS,
  ALLOC_COLORS,
} from '@/components/topdeck/panels';
import type { PfHolding } from '@/components/topdeck/panels';
import { money, rarityMeta, rarityArt } from '@/components/topdeck/lib';
import type { Rarity } from '@/components/topdeck/lib';

export default function PortfolioPage() {
  const totalVal = PF_RAW.reduce((s, h) => s + h.value, 0);
  const totalCost = PF_RAW.reduce((s, h) => s + h.cost, 0);
  const gain = totalVal - totalCost;
  const pct = totalCost > 0 ? (gain / totalCost) * 100 : 0;
  const signPct = (p: number) => (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '%';
  const histVals = [...PF_HIST_VALS, totalVal];
  const histMax = Math.max(...histVals);
  const allocMap = {} as Partial<Record<Rarity, number>>;
  PF_RAW.forEach((h) => { allocMap[h.rarity] = (allocMap[h.rarity] ?? 0) + h.value; });
  const alloc = (['legendary', 'epic', 'rare', 'common'] as Rarity[])
    .filter((r) => allocMap[r])
    .map((r) => { const v = allocMap[r]!; const p = (v / totalVal) * 100; return { label: rarityMeta(r).label, color: ALLOC_COLORS[r], pct: Math.round(p) + '%', width: p + '%', valueFmt: money(v) }; });
  const best = [...PF_RAW].map((h) => ({ h, pct: h.cost > 0 ? ((h.value - h.cost) / h.cost) * 100 : 0 })).sort((a, b) => b.pct - a.pct)[0]!;
  const losers = PF_RAW.filter((h) => h.value < h.cost).length;

  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>Portfolio</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 8, fontWeight: 500 }}>Your collection, valued live against the market.</div>

      {/* value + chart */}
      <div className="stack" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, marginTop: 24, alignItems: 'stretch' }}>
        <div style={{ background: INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: '5px 5px 0 #ff4d3d', padding: 24, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)' }}>Total portfolio value</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 46, lineHeight: 1, marginTop: 6 }}>{money(totalVal)}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 14, fontSize: 13.5, fontWeight: 800, padding: '7px 13px', borderRadius: 9, background: gain >= 0 ? '#13c06a' : '#ff4d3d', color: '#fff', border: '2.5px solid #fff', width: 'fit-content' }}>
            {(gain >= 0 ? '▲ ' : '▼ ') + '$' + Math.abs(gain).toLocaleString() + ' (' + signPct(pct) + ')'}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 26, marginTop: 22, paddingTop: 18, borderTop: '1.5px solid rgba(255,255,255,.18)' }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', fontWeight: 700 }}>Cost basis</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginTop: 3 }}>{money(totalCost)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', fontWeight: 700 }}>Cards held</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginTop: 3 }}>{PF_RAW.length}</div>
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `5px 5px 0 ${INK}`, padding: '20px 22px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17 }}>Value over time</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Last 8 months</div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 10, paddingTop: 24, minHeight: 190 }}>
            {histVals.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', height: Math.round((v / histMax) * 150), background: i === histVals.length - 1 ? '#ff4d3d' : '#ffd84d', border: `2.5px solid ${INK}`, borderRadius: '7px 7px 0 0' }} />
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>{PF_HIST_LABELS[i]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* stat tiles */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
        <div style={{ flex: 1, minWidth: 150, background: '#bff3d4', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: gain >= 0 ? '#0a5e34' : '#a3160a' }}>{signPct(pct)}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0a5e34', marginTop: 5 }}>All-time return</div>
        </div>
        <div style={{ flex: 1.6, minWidth: 220, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>Top performer</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{best.h.name}</div>
          </div>
          <div style={{ flex: 'none', fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, color: '#0a5e34', padding: '6px 12px', borderRadius: 9, background: '#e3f8ec', border: `2.5px solid ${INK}` }}>{signPct(best.pct)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 150, background: '#ffd1cc', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: '#a3160a' }}>{losers}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#a3160a', marginTop: 5 }}>Cards in the red</div>
        </div>
      </div>

      {/* allocation */}
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
        {PF_RAW.map((h) => {
          const ch = h.value - h.cost;
          const p = h.cost > 0 ? (ch / h.cost) * 100 : 0;
          const up = ch >= 0;
          const rm = rarityMeta(h.rarity);
          return (
            <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: '1.5px solid rgba(26,19,5,.1)' }}>
              <div style={{ position: 'relative', width: 46, height: 46, flex: 'none', borderRadius: 10, border: `2.5px solid ${INK}`, background: rarityArt(h.rarity) }}>
                <div style={{ position: 'absolute', bottom: 3, left: 3, fontSize: 7, fontWeight: 800, padding: '1.5px 5px', borderRadius: 4, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14.5 }}>{h.name}</div>
              <div style={{ width: 90, textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>{money(h.cost)}</div>
              <div style={{ width: 90, textAlign: 'right', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{money(h.value)}</div>
              <div style={{ width: 120, textAlign: 'right' }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: up ? '#0a5e34' : '#a3160a' }}>{signPct(p)}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: up ? '#0a5e34' : '#a3160a', marginTop: 1 }}>{(up ? '+$' : '−$') + Math.abs(ch).toLocaleString()}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { LB_USERS, LB_CFGS, LB_SUBTITLE, LB_YOU, type LbTab } from '@/components/topdeck/panels';
import { money } from '@/components/topdeck/lib';
import { INK, DISPLAY } from '@/components/topdeck/theme';

export default function LeaderboardPage() {
  const td = useTopDeck();
  const st = td.state;

  const cfg = LB_CFGS[st.lbTab];
  const deltaMeta = (d: number) =>
    d > 0 ? { t: '▲ ' + d, c: '#0a5e34' } : d < 0 ? { t: '▼ ' + Math.abs(d), c: '#a3160a' } : { t: '—', c: 'rgba(26,19,5,.4)' };
  const all = [...LB_USERS]
    .sort((a, b) => (b[cfg.key] as number) - (a[cfg.key] as number))
    .map((u, i) => ({ rank: i + 1, u, dm: deltaMeta(u.delta) }));
  const medals = [{ m: '🥇 1st', bg: '#ffd84d' }, { m: '🥈 2nd', bg: '#dfe5ee' }, { m: '🥉 3rd', bg: '#eab36a' }];
  const podium = [1, 0, 2].map((idx) => ({ entry: all[idx]!, idx, center: idx === 0 }));
  const rest = all.slice(3);
  const you = LB_YOU[st.lbTab];

  const tab = (label: string, key: LbTab, last = false) => (
    <div onClick={() => td.setLbTab(key)} style={{ fontSize: 13.5, fontWeight: 800, padding: '11px 22px', cursor: 'pointer', borderRight: last ? 'none' : `3px solid ${INK}`, background: st.lbTab === key ? INK : '#fff', color: st.lbTab === key ? '#fff' : INK }}>{label}</div>
  );

  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#ff4d3d', letterSpacing: '.04em', marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d3d', animation: 'pulseDot 1.3s infinite' }} />SEASON 4 · ENDS IN 12 DAYS
      </div>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>Leaderboard</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 8, fontWeight: 500 }}>{LB_SUBTITLE[st.lbTab]}</div>

      <div style={{ display: 'inline-flex', border: `3px solid ${INK}`, borderRadius: 11, overflow: 'hidden', margin: '22px 0 4px', boxShadow: `3px 3px 0 ${INK}` }}>
        {tab('Top collectors', 'collectors')}
        {tab('Top sellers', 'sellers')}
        {tab('Top traders', 'traders', true)}
      </div>

      {/* podium */}
      <div className="stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, alignItems: 'end', margin: '28px 0 30px' }}>
        {podium.map(({ entry, idx, center }) => {
          const u = entry.u;
          const medal = medals[idx]!;
          return (
            <div key={u.name} style={{ background: center ? '#fff7ec' : '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, padding: '20px 16px 22px', textAlign: 'center' }}>
              <div style={{ display: 'inline-block', fontFamily: DISPLAY, fontWeight: 800, fontSize: 13, padding: '4px 13px', borderRadius: 8, border: `2.5px solid ${INK}`, background: medal.bg, color: '#1a1305' }}>{medal.m}</div>
              <div style={{ width: center ? 66 : 54, height: center ? 66 : 54, borderRadius: 14, border: `3px solid ${INK}`, background: u.art, margin: '16px auto 0' }} />
              <div style={{ fontWeight: 700, fontSize: 16, marginTop: 12 }}>{u.name}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(26,19,5,.5)', marginTop: 3 }}>{u.tag}</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: center ? 27 : 22, marginTop: 13, lineHeight: 1 }}>{money(u[cfg.key] as number)}</div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.45)', marginTop: 5 }}>{cfg.label}</div>
            </div>
          );
        })}
      </div>

      {/* ranked list */}
      <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', background: '#ffd84d', borderBottom: `3px solid ${INK}`, fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.65)' }}>
          <div style={{ width: 28 }}>#</div>
          <div style={{ width: 40 }} />
          <div style={{ flex: 1 }}>MEMBER</div>
          <div style={{ width: 120, textAlign: 'right' }}>{cfg.label}</div>
          <div style={{ width: 64, textAlign: 'right' }}>CHANGE</div>
        </div>
        {rest.map((e) => (
          <div key={e.u.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: '1.5px solid rgba(26,19,5,.1)', background: (e.rank - 1) % 2 === 0 ? '#fff' : 'rgba(26,19,5,.04)' }}>
            <div style={{ width: 28, fontFamily: DISPLAY, fontWeight: 800, fontSize: 17 }}>{e.rank}</div>
            <div style={{ width: 40, height: 40, borderRadius: 11, border: `2.5px solid ${INK}`, background: e.u.art, flex: 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{e.u.name}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>{cfg.sub(e.u)}</div>
            </div>
            <div style={{ width: 120, textAlign: 'right', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{money(e.u[cfg.key] as number)}</div>
            <div style={{ width: 64, textAlign: 'right', fontSize: 12.5, fontWeight: 800, color: e.dm.c }}>{e.dm.t}</div>
          </div>
        ))}
      </div>

      {/* your rank */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, padding: '15px 18px', background: INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: '4px 4px 0 #ff4d3d' }}>
        <div style={{ width: 28, fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, color: '#ffd84d' }}>47</div>
        <div style={{ width: 40, height: 40, borderRadius: 11, border: '2.5px solid #fff', background: 'linear-gradient(135deg,#ff4d3d,#ffb83d)', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5 }}>You</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>{you.sub}</div>
        </div>
        <div style={{ width: 120, textAlign: 'right', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, color: '#ffd84d' }}>{money(you.value)}</div>
        <div style={{ width: 64, textAlign: 'right', fontSize: 12.5, fontWeight: 800, color: '#7affb0' }}>▲ 5</div>
      </div>
    </div>
  );
}

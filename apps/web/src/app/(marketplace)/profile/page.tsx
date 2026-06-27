'use client';

import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { PROFILE_STATS, PROFILE_ACHIEVEMENTS, PROFILE_ACTIVITY, PROFILE_REVIEWS } from '@/components/topdeck/panels';
import { INK, DISPLAY, SANS } from '@/components/topdeck/theme';

export default function ProfilePage() {
  const td = useTopDeck();
  const st = td.state;

  const p = st.profile;
  const hasWebsite = !!(p.website || '').trim();

  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
      {/* header card */}
      <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden' }}>
        <div style={{ height: 118, background: 'linear-gradient(120deg,#ff4d3d,#ffb83d 55%,#ffd84d)', borderBottom: `3px solid ${INK}` }} />
        <div style={{ padding: '0 26px 22px', display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ width: 96, height: 96, borderRadius: 20, border: `3px solid ${INK}`, background: 'linear-gradient(135deg,#ff4d3d,#ffb83d)', marginTop: -48, boxShadow: `3px 3px 0 ${INK}`, flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 200, paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>{p.username}</h1>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 7, background: '#cfe0ff', border: `2.5px solid ${INK}`, whiteSpace: 'nowrap' }}>🛡 VERIFIED</span>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.55)', marginTop: 9 }}>
              <span>📍 {p.location}</span>
              <span>🗓 Member since {p.memberSince}</span>
              <span>🏅 #47 collector this season</span>
              {hasWebsite && <span>🔗 {p.website}</span>}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(26,19,5,.7)', marginTop: 11, maxWidth: 540, lineHeight: 1.45 }}>{p.bio}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, paddingTop: 14 }}>
            <div onClick={td.startEditProfile} style={{ fontSize: 13, fontWeight: 800, padding: '11px 18px', background: INK, color: '#fff', border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: '2px 2px 0 #ff4d3d', cursor: 'pointer' }}>Edit profile</div>
            <div style={{ fontSize: 13, fontWeight: 800, padding: '11px 16px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 10, cursor: 'pointer' }}>↗ Share</div>
          </div>
        </div>
      </div>

      {/* stats strip */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
        {PROFILE_STATS.map((s) => (
          <div key={s.l} style={{ flex: 1, minWidth: 140, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, lineHeight: 1 }}>{s.v}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 5 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* achievements */}
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, margin: '30px 0 14px' }}>Achievements</div>
      <div className="td-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {PROFILE_ACHIEVEMENTS.map((a) => {
          const Icon = a.icon;
          return (
            <div key={a.name} style={{ position: 'relative', background: a.got ? a.bg : '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: 16, textAlign: 'center', opacity: a.got ? 1 : 0.5 }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 30, color: INK }}>
                <Icon style={{ fontSize: 30 }} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginTop: 9, color: a.got ? INK : 'rgba(26,19,5,.5)' }}>{a.name}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 3, lineHeight: 1.3 }}>{a.desc}</div>
              {!a.got && <div style={{ position: 'absolute', top: 9, right: 11, fontSize: 13 }}>🔒</div>}
            </div>
          );
        })}
      </div>

      {/* activity + reviews */}
      <div className="stack" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginTop: 30, alignItems: 'start' }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, marginBottom: 14 }}>Recent activity</div>
          <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden' }}>
            {PROFILE_ACTIVITY.map((e, i) => {
              const Icon = e.icon;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 18px', borderBottom: i === PROFILE_ACTIVITY.length - 1 ? 'none' : '1.5px solid rgba(26,19,5,.1)' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, border: `2.5px solid ${INK}`, background: e.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK, flex: 'none' }}>
                    <Icon style={{ fontSize: 20 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14 }}>{e.text}</div>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15 }}>{e.amt}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.45)', minWidth: 52, textAlign: 'right' }}>{e.when}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, marginBottom: 14 }}>Reviews · ★ 4.7</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {PROFILE_REVIEWS.map((r, i) => (
              <div key={i} style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '15px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, border: `2.5px solid ${INK}`, background: r.art, flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: '#e0a92e', letterSpacing: 1 }}>{r.stars}</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.45)' }}>{r.when}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(26,19,5,.75)', marginTop: 10, lineHeight: 1.4 }}>{r.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

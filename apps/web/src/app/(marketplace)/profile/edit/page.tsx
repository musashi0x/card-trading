'use client';

import type { CSSProperties } from 'react';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { INK, DISPLAY, SANS } from '@/components/topdeck/theme';

export default function EditProfilePage() {
  const td = useTopDeck();
  const st = td.state;

  const d = st.draft ?? st.profile;

  const toggle = (on: boolean, onClick: () => void) => (
    <div onClick={onClick} style={{ width: 46, height: 28, borderRadius: 999, border: `2.5px solid ${INK}`, background: on ? '#13c06a' : '#fff', position: 'relative', cursor: 'pointer', flex: 'none' }}>
      <div style={{ position: 'absolute', top: 1, left: on ? 18 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', border: `2px solid ${INK}`, transition: 'left .15s' }} />
    </div>
  );

  const label = (text: string) => <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>{text}</div>;

  const inputStyle: CSSProperties = { width: '100%', fontFamily: SANS, fontSize: 15, fontWeight: 600, padding: '13px 15px', border: `3px solid ${INK}`, borderRadius: 11, outline: 'none', background: '#fff', boxSizing: 'border-box' };

  const cardHead = (text: string) => <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, padding: '14px 18px', borderBottom: `2.5px solid ${INK}`, background: '#ffd84d' }}>{text}</div>;

  const setting = (title: string, desc: string, on: boolean, onClick: () => void, last = false) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: last ? 'none' : '1.5px solid rgba(26,19,5,.1)' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>{desc}</div>
      </div>
      {toggle(on, onClick)}
    </div>
  );

  return (
    <div className="m-pad" style={{ maxWidth: 980, margin: '0 auto', padding: '24px 32px 90px' }}>
      <div onClick={td.cancelEdit} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 18, padding: '7px 14px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}` }}>← Back to profile</div>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, letterSpacing: '-.02em', margin: 0 }}>Edit profile</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 6, fontWeight: 500 }}>Update how the marketplace sees you.</div>

      <div className="stack" style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 36, alignItems: 'start', marginTop: 26 }}>
        {/* left: form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
            {cardHead('Public details')}
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                {label('USERNAME')}
                <input value={d.username} onChange={(e) => td.setDraft('username', e.target.value)} style={inputStyle} />
              </div>
              <div>
                {label('BIO')}
                <textarea value={d.bio} onChange={(e) => td.setDraft('bio', e.target.value)} rows={3} style={{ ...inputStyle, fontSize: 14.5, fontWeight: 500, lineHeight: 1.45, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  {label('LOCATION')}
                  <input value={d.location} onChange={(e) => td.setDraft('location', e.target.value)} placeholder="City, State" style={inputStyle} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  {label('WEBSITE')}
                  <input value={d.website} onChange={(e) => td.setDraft('website', e.target.value)} placeholder="yoursite.com" style={inputStyle} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
            {cardHead('Notifications')}
            <div style={{ padding: '4px 18px 8px' }}>
              {setting('Outbid alerts', 'Ping me the moment someone outbids me', d.notifyOutbid, () => td.toggleDraft('notifyOutbid'))}
              {setting('Auctions ending soon', "Remind me before lots I'm watching close", d.notifyEnding, () => td.toggleDraft('notifyEnding'))}
              {setting('Sale confirmations', 'Email me when one of my cards sells', d.notifySales, () => td.toggleDraft('notifySales'), true)}
            </div>
          </div>

          <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
            {cardHead('Privacy')}
            <div style={{ padding: '4px 18px 8px' }}>
              {setting('Public collection', 'Let anyone view your portfolio and stats', d.publicCollection, () => td.toggleDraft('publicCollection'), true)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <div onClick={td.saveProfile} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 28px', background: '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Save changes</div>
            <div onClick={td.cancelEdit} style={{ fontWeight: 800, fontSize: 15, padding: '14px 22px', background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer' }}>Cancel</div>
          </div>
        </div>

        {/* right: avatar */}
        <div className="m-unstick" style={{ position: 'sticky', top: 90 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 10 }}>PROFILE PHOTO</div>
          <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `5px 5px 0 ${INK}`, padding: 18, textAlign: 'center' }}>
            <div style={{ position: 'relative', width: 160, height: 160, margin: '0 auto', borderRadius: 18, border: `3px solid ${INK}`, background: 'linear-gradient(135deg,#ff4d3d,#ffb83d)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13 }}>Drop a new photo</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 14, lineHeight: 1.4 }}>Drag an image onto the square, or click to browse.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

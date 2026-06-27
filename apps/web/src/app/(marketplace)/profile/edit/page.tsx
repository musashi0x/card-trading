'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { INK, DISPLAY, SANS } from '@/components/topdeck/theme';
import { useProfile, useUpdateProfile } from '@/lib/queries';

interface FormState {
  displayName: string;
  bio: string;
  location: string;
  website: string;
  avatarUrl: string;
}

const EMPTY: FormState = { displayName: '', bio: '', location: '', website: '', avatarUrl: '' };

export default function EditProfilePage() {
  const td = useTopDeck();
  const router = useRouter();
  const { address } = td.wallet;
  const { data: profile } = useProfile(address);
  const update = useUpdateProfile(address);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  // Pre-populate from the fetched profile once it arrives.
  useEffect(() => {
    if (profile) {
      setForm({
        displayName: profile.displayName ?? '',
        bio: profile.bio ?? '',
        location: profile.location ?? '',
        website: profile.website ?? '',
        avatarUrl: profile.avatarUrl ?? '',
      });
    }
  }, [profile]);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const label = (text: string) => <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>{text}</div>;
  const inputStyle: CSSProperties = { width: '100%', fontFamily: SANS, fontSize: 15, fontWeight: 600, padding: '13px 15px', border: `3px solid ${INK}`, borderRadius: 11, outline: 'none', background: '#fff', boxSizing: 'border-box' };
  const cardHead = (text: string) => <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, padding: '14px 18px', borderBottom: `2.5px solid ${INK}`, background: '#ffd84d' }}>{text}</div>;

  const onSave = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        displayName: form.displayName.trim() || null,
        bio: form.bio.trim() || null,
        location: form.location.trim() || null,
        website: form.website.trim() || null,
        avatarUrl: form.avatarUrl.trim() || null,
      });
      router.push('/profile');
    } catch (e) {
      setError((e as Error).message || 'Could not save your profile');
    }
  };

  if (!address) {
    return (
      <div className="m-pad" style={{ maxWidth: 980, margin: '0 auto', padding: '60px 32px 90px', textAlign: 'center' }}>
        <div style={{ background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16, padding: '50px 40px' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>Connect your wallet to edit your profile</div>
          <div onClick={td.wallet.connect} style={{ display: 'inline-block', marginTop: 16, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '12px 24px', background: INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Connect wallet</div>
        </div>
      </div>
    );
  }

  return (
    <div className="m-pad" style={{ maxWidth: 720, margin: '0 auto', padding: '24px 32px 90px' }}>
      <div onClick={() => router.push('/profile')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 18, padding: '7px 14px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}` }}>← Back to profile</div>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, letterSpacing: '-.02em', margin: 0 }}>Edit profile</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 6, fontWeight: 500 }}>Update how the marketplace sees you.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 26 }}>
        <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
          {cardHead('Public details')}
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              {label('DISPLAY NAME')}
              <input value={form.displayName} onChange={(e) => set('displayName', e.target.value)} placeholder="Your handle" style={inputStyle} />
            </div>
            <div>
              {label('BIO')}
              <textarea value={form.bio} onChange={(e) => set('bio', e.target.value)} rows={3} style={{ ...inputStyle, fontSize: 14.5, fontWeight: 500, lineHeight: 1.45, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                {label('LOCATION')}
                <input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="City, State" style={inputStyle} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                {label('WEBSITE')}
                <input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="yoursite.com" style={inputStyle} />
              </div>
            </div>
            <div>
              {label('AVATAR IMAGE URL')}
              <input value={form.avatarUrl} onChange={(e) => set('avatarUrl', e.target.value)} placeholder="https://…" style={inputStyle} />
            </div>
          </div>
        </div>

        {error && <div style={{ color: '#b3261e', fontSize: 13.5, fontWeight: 700 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <div onClick={() => { if (!update.isPending) void onSave(); }} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 28px', background: update.isPending ? '#cfc8b8' : '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: update.isPending ? 'default' : 'pointer' }}>{update.isPending ? 'Saving…' : 'Save changes'}</div>
          <div onClick={() => router.push('/profile')} style={{ fontWeight: 800, fontSize: 15, padding: '14px 22px', background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer' }}>Cancel</div>
        </div>
      </div>
    </div>
  );
}

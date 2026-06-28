'use client';

import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { ProfileView } from '@/components/topdeck/ProfileView';
import { INK, DISPLAY } from '@/components/topdeck/theme';

export default function ProfilePage() {
  const td = useTopDeck();
  const { address } = td.wallet;

  if (!address) {
    return (
      <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '60px 32px 90px' }}>
        <div style={{ textAlign: 'center', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16, padding: '60px 40px' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>Connect your wallet to view your profile</div>
          <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 8 }}>Your profile, stats, and reviews live with your wallet.</div>
          <div onClick={td.wallet.connect} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '12px 24px', background: INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Connect wallet</div>
        </div>
      </div>
    );
  }

  return <ProfileView address={address} isOwner />;
}

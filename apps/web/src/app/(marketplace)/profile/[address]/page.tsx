'use client';

import { useParams } from 'next/navigation';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { ProfileView } from '@/components/topdeck/ProfileView';
import { INK, DISPLAY } from '@/components/topdeck/theme';

/**
 * Public store view for any seller, reached via the "View store" button on a
 * card. Shows the same profile UI as `/profile`, read-only unless the viewer is
 * looking at their own wallet (in which case the Edit action is offered).
 */
export default function SellerStorePage() {
  const params = useParams<{ address: string }>();
  const address = params?.address ? decodeURIComponent(params.address) : '';
  const td = useTopDeck();
  const isOwner = !!td.wallet.address && td.wallet.address === address;

  if (!address) {
    return (
      <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '60px 32px 90px' }}>
        <div style={{ textAlign: 'center', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16, padding: '60px 40px' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>Store not found</div>
          <div onClick={td.goBrowse} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '12px 24px', background: INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Back to auctions</div>
        </div>
      </div>
    );
  }

  return <ProfileView address={address} isOwner={isOwner} />;
}

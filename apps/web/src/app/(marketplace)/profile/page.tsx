'use client';

import { useRouter } from 'next/navigation';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { shorten } from '@/components/topdeck/lib';
import { INK, DISPLAY } from '@/components/topdeck/theme';
import { useProfile, useProfileReviews, useProfileStats } from '@/lib/queries';
import ShieldIcon from '@mui/icons-material/Shield';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import LinkIcon from '@mui/icons-material/Link';
import StarIcon from '@mui/icons-material/Star';
import LockIcon from '@mui/icons-material/Lock';

function money(v: string | number): string {
  return '$' + Math.round(Number(v)).toLocaleString();
}

function relativeDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProfilePage() {
  const td = useTopDeck();
  const router = useRouter();
  const { address } = td.wallet;
  const { data: profile } = useProfile(address);
  const { data: stats } = useProfileStats(address);
  const { data: reviews } = useProfileReviews(address);

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

  const name = (profile?.displayName || '').trim() || shorten(address);
  const website = (profile?.website || '').trim();
  const memberYear = profile?.memberSince ? new Date(profile.memberSince).getFullYear() : '—';
  const rating = stats?.sellerRating;

  const statCards = [
    { v: stats ? money(stats.collectionValueUsdc) : '—', l: 'Collection value' },
    { v: stats ? String(stats.cardsOwned) : '—', l: 'Cards owned' },
    { v: stats ? String(stats.cardsSold) : '—', l: 'Cards sold' },
    { v: rating != null ? `★ ${rating.toFixed(1)}` : '—', l: 'Seller rating' },
    { v: stats?.winRate != null ? `${stats.winRate}%` : '—', l: 'Win rate' },
  ];

  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
      {/* header card */}
      <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden' }}>
        <div style={{ height: 118, background: 'linear-gradient(120deg,#ff4d3d,#ffb83d 55%,#ffd84d)', borderBottom: `3px solid ${INK}` }} />
        <div style={{ padding: '0 26px 22px', display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ width: 96, height: 96, borderRadius: 20, border: `3px solid ${INK}`, background: profile?.avatarUrl ? `center/cover no-repeat url("${profile.avatarUrl}")` : 'linear-gradient(135deg,#ff4d3d,#ffb83d)', marginTop: -48, boxShadow: `3px 3px 0 ${INK}`, flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 200, paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>{name}</h1>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 7, background: '#cfe0ff', border: `2.5px solid ${INK}`, whiteSpace: 'nowrap' }}>
                <ShieldIcon sx={{ fontSize: 13 }} />
                <span>{shorten(address)}</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.55)', marginTop: 9 }}>
              {profile?.location && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <LocationOnIcon sx={{ fontSize: 14 }} />
                  <span>{profile.location}</span>
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CalendarMonthIcon sx={{ fontSize: 14 }} />
                <span>Member since {memberYear}</span>
              </span>
              {website && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <LinkIcon sx={{ fontSize: 14 }} />
                  <span>{website}</span>
                </span>
              )}
            </div>
            {profile?.bio && <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(26,19,5,.7)', marginTop: 11, maxWidth: 540, lineHeight: 1.45 }}>{profile.bio}</div>}
          </div>
          <div style={{ display: 'flex', gap: 10, paddingTop: 14 }}>
            <div onClick={() => router.push('/profile/edit')} style={{ fontSize: 13, fontWeight: 800, padding: '11px 18px', background: INK, color: '#fff', border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: '2px 2px 0 #ff4d3d', cursor: 'pointer' }}>Edit profile</div>
          </div>
        </div>
      </div>

      {/* stats strip */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
        {statCards.map((s) => (
          <div key={s.l} style={{ flex: 1, minWidth: 140, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, lineHeight: 1 }}>{s.v}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 5 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* achievements */}
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, margin: '30px 0 14px' }}>Achievements</div>
      <div className="td-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {(stats?.achievements ?? []).map((a) => (
          <div key={a.key} style={{ position: 'relative', background: a.earned ? '#ffd84d' : '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: 16, textAlign: 'center', opacity: a.earned ? 1 : 0.5 }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 30, color: INK }}>
              <EmojiEventsIcon style={{ fontSize: 30 }} />
            </div>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginTop: 9, color: a.earned ? INK : 'rgba(26,19,5,.5)' }}>{a.name}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 3, lineHeight: 1.3 }}>{a.description}</div>
            {!a.earned && (
              <div style={{ position: 'absolute', top: 9, right: 11 }}>
                <LockIcon sx={{ fontSize: 15, color: 'rgba(26,19,5,.3)' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* reviews */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, margin: '30px 0 14px' }}>
        <span>Reviews</span>
        {rating != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            · <StarIcon sx={{ fontSize: 18, color: '#e0a92e' }} />
            <span>{rating.toFixed(1)}</span>
          </span>
        )}
      </div>
      {reviews && reviews.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {reviews.map((r) => (
            <div key={r.id} style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '15px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, border: `2.5px solid ${INK}`, background: 'linear-gradient(135deg,#2d5bff,#3ff0ff)', flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{shorten(r.reviewerAddress)}</div>
                  <div style={{ fontSize: 12, color: '#e0a92e', letterSpacing: 1 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.45)' }}>{relativeDay(r.createdAt)}</div>
              </div>
              {r.text && <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(26,19,5,.75)', marginTop: 10, lineHeight: 1.4 }}>{r.text}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: '#fff', border: `3px dashed ${INK}`, borderRadius: 14, padding: '30px 24px', textAlign: 'center', fontSize: 13.5, color: 'rgba(26,19,5,.55)', fontWeight: 500 }}>
          No reviews yet. Complete a trade to earn your first one.
        </div>
      )}
    </div>
  );
}

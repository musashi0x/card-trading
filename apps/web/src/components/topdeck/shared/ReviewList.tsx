'use client';

import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import DeleteIcon from '@mui/icons-material/Delete';
import type { CardReview } from '@cardmkt/shared';
import { INK, DISPLAY } from '@/components/topdeck/theme';
import { fmtAgo } from '@/components/topdeck/lib';

function Stars({ n }: { n: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1, verticalAlign: 'middle', color: '#e0a92e', fontSize: 15 }}>
      {[1, 2, 3, 4, 5].map((i) =>
        i <= n ? <StarIcon key={i} fontSize="inherit" /> : <StarBorderIcon key={i} fontSize="inherit" />,
      )}
    </span>
  );
}

function truncAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Props {
  reviews: CardReview[];
  averageStars: number | null;
  reviewCount: number;
  myAddress: string | null | undefined;
  onDelete: (reviewId: string) => void;
  deleting: boolean;
  now: number;
}

export function ReviewList({ reviews, averageStars, reviewCount, myAddress, onDelete, deleting, now }: Props) {
  if (reviewCount === 0) {
    return (
      <div style={{ padding: '14px 0', fontSize: 13, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>
        No reviews yet — be the first to rate this card.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Stars n={Math.round(averageStars ?? 0)} />
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>
          {averageStars?.toFixed(1)}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>
          ({reviewCount} {reviewCount === 1 ? 'review' : 'reviews'})
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {reviews.map((r) => (
          <div
            key={r.id}
            style={{ padding: '12px 14px', background: '#fff', border: `1.5px solid ${INK}`, borderRadius: 10 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Stars n={r.stars} />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{truncAddr(r.authorAddress)}</span>
                {r.authorAddress === myAddress && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(26,19,5,.07)' }}>you</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.45)' }}>
                  {r.updatedAt !== r.createdAt ? 'edited ' : ''}{fmtAgo(now - new Date(r.updatedAt).getTime())}
                </span>
                {r.authorAddress === myAddress && (
                  <div
                    onClick={() => !deleting && onDelete(r.id)}
                    style={{ cursor: deleting ? 'default' : 'pointer', color: '#a3160a', opacity: deleting ? 0.4 : 1 }}
                  >
                    <DeleteIcon sx={{ fontSize: 17 }} />
                  </div>
                )}
              </div>
            </div>
            {r.body && (
              <div style={{ fontSize: 13, fontWeight: 500, color: INK, lineHeight: 1.5 }}>{r.body}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

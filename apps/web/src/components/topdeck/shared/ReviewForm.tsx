'use client';

import { useState } from 'react';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { INK, DISPLAY } from '@/components/topdeck/theme';

interface Props {
  onSubmit: (stars: number, body: string) => void;
  submitting: boolean;
  existing?: { stars: number; body: string | null };
}

export function ReviewForm({ onSubmit, submitting, existing }: Props) {
  const [stars, setStars] = useState(existing?.stars ?? 0);
  const [hovered, setHovered] = useState(0);
  const [body, setBody] = useState(existing?.body ?? '');

  const handleSubmit = () => {
    if (stars < 1 || submitting) return;
    onSubmit(stars, body.trim());
  };

  return (
    <div style={{ marginTop: 16, padding: '16px 18px', background: '#fff', border: `2px solid ${INK}`, borderRadius: 12 }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, marginBottom: 10 }}>
        {existing ? 'Update your review' : 'Leave a review'}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n <= (hovered || stars);
          return (
            <div
              key={n}
              onClick={() => setStars(n)}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              style={{ cursor: 'pointer', color: active ? '#e0a92e' : 'rgba(26,19,5,.25)', fontSize: 28 }}
            >
              {active ? <StarIcon fontSize="inherit" /> : <StarBorderIcon fontSize="inherit" />}
            </div>
          );
        })}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        placeholder="Share your thoughts about this card… (optional)"
        style={{
          width: '100%', boxSizing: 'border-box', minHeight: 80, resize: 'vertical',
          padding: '10px 12px', fontSize: 13, fontWeight: 500, border: `2px solid ${INK}`,
          borderRadius: 9, fontFamily: 'inherit', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{ fontSize: 11, color: 'rgba(26,19,5,.45)', fontWeight: 600 }}>{body.length}/1000</div>
        <div
          onClick={handleSubmit}
          style={{
            fontSize: 13, fontWeight: 800, padding: '8px 18px', borderRadius: 9, cursor: stars < 1 || submitting ? 'default' : 'pointer',
            background: stars < 1 || submitting ? 'rgba(26,19,5,.2)' : INK, color: '#fff',
            border: `2px solid ${stars < 1 || submitting ? 'rgba(26,19,5,.2)' : INK}`, fontFamily: DISPLAY,
          }}
        >
          {submitting ? 'Saving…' : existing ? 'Update review' : 'Submit review'}
        </div>
      </div>
    </div>
  );
}

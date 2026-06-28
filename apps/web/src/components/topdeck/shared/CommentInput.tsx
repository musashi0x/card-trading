'use client';

import { useState } from 'react';
import { INK, DISPLAY } from '@/components/topdeck/theme';

interface Props {
  connected: boolean;
  onConnect: () => void;
  onSubmit: (body: string) => void;
  submitting: boolean;
}

export function CommentInput({ connected, onConnect, onSubmit, submitting }: Props) {
  const [body, setBody] = useState('');

  const handleSubmit = () => {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    onSubmit(trimmed);
    setBody('');
  };

  if (!connected) {
    return (
      <div
        onClick={onConnect}
        style={{
          marginTop: 12, padding: '13px 18px', background: '#fff', border: `2px dashed ${INK}`,
          borderRadius: 11, fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)', cursor: 'pointer',
          textAlign: 'center',
        }}
      >
        Connect wallet to comment
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        placeholder="Add a comment…"
        style={{
          width: '100%', boxSizing: 'border-box', minHeight: 72, resize: 'vertical',
          padding: '10px 12px', fontSize: 13, fontWeight: 500, border: `2px solid ${INK}`,
          borderRadius: 9, fontFamily: 'inherit', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <div style={{ fontSize: 11, color: 'rgba(26,19,5,.45)', fontWeight: 600 }}>{body.length}/1000</div>
        <div
          onClick={handleSubmit}
          style={{
            fontSize: 13, fontWeight: 800, padding: '8px 18px', borderRadius: 9,
            cursor: !body.trim() || submitting ? 'default' : 'pointer',
            background: !body.trim() || submitting ? 'rgba(26,19,5,.2)' : INK,
            color: '#fff', fontFamily: DISPLAY,
          }}
        >
          {submitting ? 'Posting…' : 'Post'}
        </div>
      </div>
    </div>
  );
}

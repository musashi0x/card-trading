'use client';

import DeleteIcon from '@mui/icons-material/Delete';
import type { CardComment } from '@cardmkt/shared';
import { INK } from '@/components/topdeck/theme';
import { fmtAgo } from '@/components/topdeck/lib';

function truncAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Props {
  comments: CardComment[];
  myAddress: string | null | undefined;
  onDelete: (commentId: string) => void;
  deleting: boolean;
  now: number;
}

export function CommentThread({ comments, myAddress, onDelete, deleting, now }: Props) {
  if (comments.length === 0) {
    return (
      <div style={{ padding: '14px 0', fontSize: 13, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>
        No comments yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {comments.map((c) => {
        const deleted = !!c.deletedAt;
        const isOwn = !deleted && c.authorAddress === myAddress;

        return (
          <div
            key={c.id}
            style={{
              padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${INK}`,
              background: deleted ? '#f8f6f2' : '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: deleted ? 'rgba(26,19,5,.35)' : INK }}>
                  {deleted ? '[deleted]' : truncAddr(c.authorAddress!)}
                </span>
                {isOwn && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(26,19,5,.07)' }}>you</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.4)' }}>
                  {fmtAgo(now - new Date(c.createdAt).getTime())}
                </span>
                {isOwn && (
                  <div
                    onClick={() => !deleting && onDelete(c.id)}
                    style={{ cursor: deleting ? 'default' : 'pointer', color: '#a3160a', opacity: deleting ? 0.4 : 1 }}
                  >
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </div>
                )}
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: deleted ? 'rgba(26,19,5,.45)' : INK, fontStyle: deleted ? 'italic' : 'normal', lineHeight: 1.5 }}>
              {c.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

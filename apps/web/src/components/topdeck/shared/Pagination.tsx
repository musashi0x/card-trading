'use client';

import type { ReactNode } from 'react';
import { useTopDeck } from '../TopDeckProvider';
import { DISPLAY, INK } from '../theme';

// Build a windowed list of page numbers around the current page, with '…' gaps
// so the bar stays compact even with many pages (e.g. 1 … 4 5 6 … 20).
function pageItems(page: number, total: number): Array<number | 'gap'> {
  const items = new Set<number>([1, total, page, page - 1, page + 1]);
  const pages = [...items].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  let prev = 0;
  pages.forEach((p) => {
    if (prev && p - prev > 1) out.push('gap');
    out.push(p);
    prev = p;
  });
  return out;
}

export function Pagination({ page, total, count, start, shown }: { page: number; total: number; count: number; start: number; shown: number }) {
  const td = useTopDeck();
  const btn = (label: ReactNode, opts: { active?: boolean; disabled?: boolean; onClick?: () => void; key: string }) => (
    <div
      key={opts.key}
      onClick={opts.disabled ? undefined : opts.onClick}
      aria-current={opts.active ? 'page' : undefined}
      style={{
        minWidth: 38, textAlign: 'center', fontSize: 13, fontWeight: 800, padding: '9px 12px',
        border: `2.5px solid ${INK}`, borderRadius: 9, fontFamily: DISPLAY,
        background: opts.active ? INK : '#fff', color: opts.active ? '#fff' : INK,
        boxShadow: opts.active ? 'none' : `2px 2px 0 ${INK}`,
        cursor: opts.disabled ? 'not-allowed' : 'pointer', opacity: opts.disabled ? 0.4 : 1,
      }}
    >
      {label}
    </div>
  );
  return (
    <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', justifyContent: 'center' }}>
        {btn('← Prev', { key: 'prev', disabled: page <= 1, onClick: () => td.setPage(page - 1) })}
        {pageItems(page, total).map((it, i) =>
          it === 'gap'
            ? <div key={`gap-${i}`} style={{ fontSize: 13, fontWeight: 800, color: 'rgba(26,19,5,.4)', padding: '0 2px' }}>…</div>
            : btn(it, { key: `p-${it}`, active: it === page, onClick: () => td.setPage(it) }),
        )}
        {btn('Next →', { key: 'next', disabled: page >= total, onClick: () => td.setPage(page + 1) })}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>
        Showing {start + 1}–{start + shown} of {count} lots
      </div>
    </div>
  );
}

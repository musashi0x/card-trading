'use client';

import { useTopDeck } from '../TopDeckProvider';
import { INK } from '../theme';
import BoltIcon from '@mui/icons-material/Bolt';
import CheckIcon from '@mui/icons-material/Check';

/** Global bottom-center toast for bid/buy/order feedback. */
export function Toast() {
  const { state: st } = useTopDeck();
  if (!st.toast) return null;
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 30, transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 11, padding: '14px 22px', background: st.toastKind === 'outbid' ? '#ff4d3d' : '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 13, boxShadow: `4px 4px 0 ${INK}`, fontWeight: 700, fontSize: 14, animation: 'modalIn .25s ease both' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 18 }}>
        {st.toastKind === 'outbid' ? <BoltIcon sx={{ fontSize: 20 }} /> : <CheckIcon sx={{ fontSize: 20 }} />}
      </span>
      <span>{st.toast}</span>
    </div>
  );
}

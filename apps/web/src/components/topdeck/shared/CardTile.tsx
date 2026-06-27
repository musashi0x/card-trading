'use client';

import { useTopDeck } from '../TopDeckProvider';
import { fmtLeft, money, rarityMeta, type TopCard } from '../lib';
import { DISPLAY, INK } from '../theme';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import TimerIcon from '@mui/icons-material/Timer';

/** A single auction lot in the browse / watchlist grids. */
export function CardTile({ card: c, height }: { card: TopCard; height: number }) {
  const td = useTopDeck();
  const rm = rarityMeta(c.rarity);
  const left = c.endsAt - td.state.now;
  const ending = left < 3600000;
  const watched = td.state.watched[c.id];
  return (
    <div
      key={c.id}
      className="td-lift"
      onClick={() => td.open(c.id)}
      style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, overflow: 'hidden', boxShadow: `4px 4px 0 ${INK}`, cursor: 'pointer' }}
    >
      <div style={{ position: 'relative', height, background: c.art }}>
        <div style={{ position: 'absolute', top: 10, left: 10, fontSize: 10, fontWeight: 800, letterSpacing: '.03em', padding: '4px 10px', borderRadius: 7, background: rm.bg, color: rm.color, border: `2px solid ${INK}` }}>{rm.label}</div>
        <div onClick={(e) => td.toggleWatch(e, c.id)} style={{ position: 'absolute', top: 9, right: 9, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: watched ? '#ff4d3d' : '#fff', border: `2px solid ${INK}`, fontSize: 14, color: watched ? '#fff' : 'rgba(26,19,5,.3)' }}>{watched ? <FavoriteIcon sx={{ fontSize: 17 }} /> : <FavoriteBorderIcon sx={{ fontSize: 17 }} />}</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, position: 'absolute', bottom: 10, right: 10, fontSize: 11, fontWeight: 800, padding: '4px 9px', borderRadius: 7, background: ending ? '#ff4d3d' : INK, color: '#fff', border: `2px solid ${INK}` }}>
          <TimerIcon sx={{ fontSize: 13 }} />
          <span>{fmtLeft(left)}</span>
        </div>
      </div>
      <div style={{ padding: '13px 14px 15px' }}>
        <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{c.name}</div>
        <div style={{ fontSize: 11.5, color: 'rgba(26,19,5,.5)', marginTop: 3, fontWeight: 500 }}>{c.condition}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 13 }}>
          <div>
            <div style={{ fontSize: 10.5, color: 'rgba(26,19,5,.5)', fontWeight: 600 }}>Current bid</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>{money(c.currentBid)}</div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>{c.bids.length} bids</div>
        </div>
      </div>
    </div>
  );
}

/** Shared chip background style for active/inactive filter & sort chips. */
export function chipStyle(active: boolean) {
  return { background: active ? INK : '#fff', color: active ? '#fff' : INK } as const;
}

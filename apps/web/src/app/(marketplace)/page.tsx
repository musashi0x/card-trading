'use client';

import type { ReactNode } from 'react';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { CardTile, chipStyle } from '@/components/topdeck/shared/CardTile';
import { Pagination } from '@/components/topdeck/shared/Pagination';
import { type Rarity, type TopCard } from '@/components/topdeck/lib';
import { DISPLAY, INK, PAGE_SIZE } from '@/components/topdeck/theme';
import TuneIcon from '@mui/icons-material/Tune';
import CloseIcon from '@mui/icons-material/Close';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import TimerIcon from '@mui/icons-material/Timer';
import BoltIcon from '@mui/icons-material/Bolt';
import ShieldIcon from '@mui/icons-material/Shield';

export default function BrowsePage() {
  const td = useTopDeck();
  const st = td.state;
  const fc = st.facets;

  // filtered + sorted browse list
  const query = st.query.trim().toLowerCase();
  let list = st.cards.filter((c) => {
    if (query) {
      const hay = `${c.name} ${c.setLine} ${c.condition} ${c.seller} ${c.rarity}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (fc.cats.length && !fc.cats.some((cat) => c.cats.includes(cat))) return false;
    if (fc.rarities.length && !fc.rarities.includes(c.rarity)) return false;
    if (fc.graded && !c.cats.includes('Graded')) return false;
    if (fc.buyNow && !(c.buyNow > 0)) return false;
    if (fc.ending && c.endsAt - st.now >= 3600000) return false;
    if (fc.price !== 'any') {
      const p = c.currentBid;
      if (fc.price === 'lt100' && !(p < 100)) return false;
      if (fc.price === '100to1k' && !(p >= 100 && p <= 1000)) return false;
      if (fc.price === 'gt1k' && !(p > 1000)) return false;
    }
    return true;
  });
  const sortFns: Record<string, (a: TopCard, b: TopCard) => number> = {
    ending: (a, b) => a.endsAt - st.now - (b.endsAt - st.now),
    priceUp: (a, b) => a.currentBid - b.currentBid,
    priceDown: (a, b) => b.currentBid - a.currentBid,
    bids: (a, b) => b.bids.length - a.bids.length,
  };
  list = [...list].sort(sortFns[st.sort] || sortFns.ending);

  // pagination: clamp the page in case the filtered list shrank below it
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(st.page, totalPages);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageList = list.slice(pageStart, pageStart + PAGE_SIZE);

  const catOpts = ['Pokémon', 'Sports', 'Other'].map((v) => ({ label: v, value: v, active: fc.cats.includes(v), onClick: () => td.toggleCat(v) }));
  const rarityOpts: Array<[Rarity, string, string]> = [['common', 'Common', '#13c06a'], ['rare', 'Rare', '#2d5bff'], ['epic', 'Epic', '#7c3aed'], ['legendary', 'Legendary', '#e0a92e']];
  const priceOpts: Array<[string, string]> = [['any', 'Any price'], ['lt100', 'Under $100'], ['100to1k', '$100 – $1,000'], ['gt1k', '$1,000+']];
  const statusOpts: Array<{ key: 'ending' | 'buyNow' | 'graded'; label: ReactNode }> = [
    { key: 'ending', label: <><TimerIcon sx={{ fontSize: 15 }} /> Ending soon</> },
    { key: 'buyNow', label: <><BoltIcon sx={{ fontSize: 15 }} /> Buy Now available</> },
    { key: 'graded', label: <><ShieldIcon sx={{ fontSize: 15 }} /> Graded only</> },
  ];
  const sortOpts: Array<[string, string]> = [['ending', 'Ending soon'], ['priceUp', 'Price: low → high'], ['priceDown', 'Price: high → low'], ['bids', 'Most bids']];
  const activeCount = fc.cats.length + fc.rarities.length + (fc.graded ? 1 : 0) + (fc.buyNow ? 1 : 0) + (fc.ending ? 1 : 0) + (fc.price !== 'any' ? 1 : 0) + (query ? 1 : 0);

  const filterChip = (key: string, label: ReactNode, active: boolean, onClick: () => void, extra?: ReactNode) => (
    <div key={key} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, padding: '8px 12px', border: `2.5px solid ${INK}`, borderRadius: 9, cursor: 'pointer', ...chipStyle(active) }}>
      {extra}{label}
    </div>
  );

  return (
    <div className="m-pad" style={{ maxWidth: 1180, margin: '0 auto', padding: '30px 32px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 8 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#ff4d3d', letterSpacing: '.04em', marginBottom: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d3d', animation: 'pulseDot 1.3s infinite' }} />LIVE AUCTIONS
          </div>
          <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>Bid, win, collect.</h1>
          <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 8, fontWeight: 500 }}>{list.length} cards under the hammer · new lots every hour</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>{list.length} of {st.cards.length} lots</div>
          <div onClick={td.toggleFilters} className="filters-trigger" style={{ alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, padding: '9px 15px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer' }}>
            <TuneIcon sx={{ fontSize: 18 }} />
            {activeCount > 0 && <span style={{ fontSize: 11, fontWeight: 800, minWidth: 18, height: 18, padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ff4d3d', color: '#fff', border: `2px solid ${INK}`, borderRadius: 999 }}>{activeCount}</span>}
          </div>
        </div>
      </div>

      <div className="browse-layout">
        {/* Filters — docked sidebar on desktop, right slide-in drawer on mobile */}
        <aside className={`filter-panel${st.filtersOpen ? ' open' : ''}`} aria-label="Filters">
          <div className="filter-panel__head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>Filters</div>
              {activeCount > 0 && <span style={{ fontSize: 11, fontWeight: 800, minWidth: 18, height: 18, padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ff4d3d', color: '#fff', border: `2px solid ${INK}`, borderRadius: 999 }}>{activeCount}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {activeCount > 0 && <div onClick={td.clearFilters} style={{ fontSize: 11.5, fontWeight: 800, padding: '5px 11px', background: INK, color: '#fff', borderRadius: 7, cursor: 'pointer' }}>Clear {activeCount}</div>}
              <div onClick={td.closeFilters} className="filters-close" title="Close filters" style={{ cursor: 'pointer' }}><CloseIcon sx={{ fontSize: 22 }} /></div>
            </div>
          </div>
          <div className="filter-panel__body">
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>CATEGORY</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {catOpts.map((o) => (
                  <div key={o.value} onClick={o.onClick} style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', border: `2.5px solid ${INK}`, borderRadius: 999, cursor: 'pointer', ...chipStyle(o.active) }}>{o.label}</div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>RARITY</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {rarityOpts.map(([v, label, dot]) => filterChip(v, label, fc.rarities.includes(v), () => td.toggleRarity(v),
                  <span key="d" style={{ width: 11, height: 11, borderRadius: '50%', background: dot, border: `2px solid ${INK}`, flex: 'none' }} />))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>PRICE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {priceOpts.map(([v, label]) => filterChip(v, label, fc.price === v, () => td.setPrice(v)))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>STATUS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {statusOpts.map((o) => filterChip(o.key, o.label, fc[o.key], () => td.toggleFlag(o.key)))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>SORT BY</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {sortOpts.map(([v, label]) => filterChip(v, label, st.sort === v, () => td.setSort(v)))}
              </div>
            </div>
          </div>
        </aside>

        {/* grid */}
        <div>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 24px', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}><SearchOffIcon sx={{ fontSize: 48, color: 'rgba(26,19,5,.4)' }} /></div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 21, marginTop: 10 }}>{query ? `No lots match “${st.query.trim()}”` : 'No lots match those filters'}</div>
              <div style={{ fontSize: 13.5, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 6 }}>{query ? 'Try a different search or clear it.' : 'Try loosening a filter or two.'}</div>
              <div onClick={td.clearFilters} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '12px 22px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>{query ? 'Clear search & filters' : 'Clear filters'}</div>
            </div>
          ) : (
            <>
              <div className="td-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
                {pageList.map((c) => <CardTile key={c.id} card={c} height={172} />)}
              </div>
              {totalPages > 1 && <Pagination page={page} total={totalPages} count={list.length} start={pageStart} shown={pageList.length} />}
            </>
          )}
        </div>
      </div>

      {/* Backdrop dims the page behind the mobile filter drawer */}
      <div className={`filter-backdrop${st.filtersOpen ? ' open' : ''}`} onClick={td.closeFilters} />
    </div>
  );
}

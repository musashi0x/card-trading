'use client';

import { useTopDeck } from '../TopDeckProvider';
import { INK } from '../theme';
import MenuIcon from '@mui/icons-material/Menu';

export interface NavItem {
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * Mobile-only: the nav tabs collapse into a single dropdown (the inline links
 * overflow once the nav wraps). CSS shows this only ≤900px; the button surfaces
 * the active section so the user keeps their bearings.
 */
export function NavMenu({ items }: { items: NavItem[] }) {
  const td = useTopDeck();
  const open = td.state.navMenuOpen;
  const active = items.find((i) => i.active);
  return (
    <div className="nav-menu" style={{ position: 'relative' }}>
      <div onClick={td.toggleNavMenu} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, padding: '9px 14px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer' }}>
        <MenuIcon sx={{ fontSize: 18 }} />
        {active ? active.label : 'Menu'}
        <span style={{ fontSize: 9, marginLeft: -2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
      </div>
      {open && (
        <>
          {/* click-outside backdrop */}
          <div onClick={td.closeNavMenu} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 41, width: 200, background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
            {items.map((it, i) => (
              <div
                key={it.label}
                onClick={() => { it.onClick(); td.closeNavMenu(); }}
                style={{ fontSize: 13.5, fontWeight: 700, padding: '12px 14px', cursor: 'pointer', background: it.active ? INK : '#fff', color: it.active ? '#fff' : INK, borderBottom: i === items.length - 1 ? 'none' : '2px solid rgba(26,19,5,.1)' }}
              >
                {it.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { usePathname } from 'next/navigation';
import { useTopDeck } from '../TopDeckProvider';
import { shorten } from '../lib';
import { DISPLAY, INK } from '../theme';
import { NavMenu, type NavItem } from './NavMenu';
import { WalletMenu } from './WalletMenu';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import BoltIcon from '@mui/icons-material/Bolt';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';

/** A top-nav text link with the design's underline active-state. */
function NavLink({ label, active, onClick }: NavItem) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? INK : 'rgba(26,19,5,.55)', paddingBottom: 2, borderBottom: active ? `2.5px solid ${INK}` : '2.5px solid transparent' }}>{label}</div>
    </div>
  );
}

export function TopNav() {
  const td = useTopDeck();
  const st = td.state;
  const wallet = td.wallet;
  const pathname = usePathname();

  const onAuctions = pathname === '/' || pathname.startsWith('/card/') || pathname === '/sell';
  const onProfile = pathname === '/profile' || pathname === '/profile/edit';

  const navItems: NavItem[] = [
    { label: 'Auctions', active: onAuctions, onClick: td.goHome },
    { label: 'My bids', active: pathname === '/my-bids', onClick: td.goMyBids },
    { label: 'Leaderboard', active: pathname === '/leaderboard', onClick: td.goLeaderboard },
    { label: 'Portfolio', active: pathname === '/portfolio', onClick: td.goPortfolio },
    { label: 'Orders', active: pathname === '/orders', onClick: td.openOrders },
    { label: 'Trade', active: pathname === '/trade', onClick: td.goTrade },
    { label: 'History', active: pathname === '/trades', onClick: td.goTrades },
  ];

  return (
    <div className="topnav" style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', alignItems: 'center', gap: 18, padding: '14px 32px', background: '#ffd84d', borderBottom: `3px solid ${INK}` }}>
      <div onClick={td.goHome} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap', fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, letterSpacing: '-.03em', cursor: 'pointer' }}>
        <span>TOP<span style={{ color: '#ff4d3d' }}>DECK</span></span>
      </div>
      <div className="nav-search" style={{ flex: 1, maxWidth: 460, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, padding: '9px 14px' }}>
        <SearchIcon sx={{ fontSize: 18, color: 'rgba(26,19,5,.45)' }} />
        <input
          value={st.query}
          onChange={td.setQuery}
          placeholder="Search 2.4M cards & collectibles…"
          aria-label="Search auctions"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: "'DM Sans',system-ui", fontSize: 13.5, fontWeight: 500, color: INK }}
        />
        {st.query && (
          <span onClick={td.clearQuery} title="Clear search" style={{ cursor: 'pointer', display: 'flex', color: 'rgba(26,19,5,.45)', padding: '0 2px' }}><CloseIcon sx={{ fontSize: 16 }} /></span>
        )}
      </div>
      <div className="nav-spacer" style={{ flex: 1 }} />
      <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        {navItems.map((it) => <NavLink key={it.label} {...it} />)}
      </div>
      <NavMenu items={navItems} />
      <div onClick={td.goSell} style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap', padding: '9px 16px', background: '#2d5bff', color: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer' }}>Sell a card</div>
      {wallet.passkeyAvailable && !wallet.address && (
        <div onClick={() => { if (!wallet.connecting) void wallet.connectViaPasskey(); }} title="Create or connect a passkey smart wallet — no seed phrase" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 800, flexShrink: 0, whiteSpace: 'nowrap', padding: '8px 13px', background: INK, color: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer' }}>
          <BoltIcon sx={{ fontSize: 16 }} />
          <span>Face ID</span>
        </div>
      )}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div onClick={td.onWalletClick} title={wallet.address ? 'Manage wallet' : 'Connect wallet'} style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 800, padding: '8px 13px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: wallet.address ? '#13c06a' : 'rgba(26,19,5,.3)' }} />
          {wallet.connecting ? (
            'Connecting…'
          ) : wallet.address ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {wallet.walletKind === 'passkey' && <BoltIcon sx={{ fontSize: 14 }} />}
              <span>{shorten(wallet.address)}</span>
            </span>
          ) : (
            'Connect'
          )}
          {wallet.address && <span style={{ fontSize: 9, marginLeft: -2, transform: st.walletMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>}
        </div>
        {wallet.address && st.walletMenuOpen && <WalletMenu address={wallet.address} />}
      </div>
      <div onClick={td.openGuide} title="View introduction guide" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: '#fff', border: `2.5px solid ${INK}`, cursor: 'pointer', boxShadow: `2px 2px 0 ${INK}`, flexShrink: 0 }}>
        <HelpOutlineIcon sx={{ fontSize: 18 }} />
      </div>
      <div onClick={td.goProfile} title="Profile" style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#ff4d3d,#ffb83d)', border: `2.5px solid ${INK}`, cursor: 'pointer', boxShadow: onProfile ? '0 0 0 3px #ff4d3d' : 'none' }} />
    </div>
  );
}

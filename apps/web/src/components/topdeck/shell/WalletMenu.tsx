'use client';

import type { ReactNode } from 'react';
import { useTopDeck } from '../TopDeckProvider';
import { INK } from '../theme';
import BoltIcon from '@mui/icons-material/Bolt';

/** The connected-wallet management dropdown: view, copy, explorer, disconnect. */
export function WalletMenu({ address }: { address: string }) {
  const td = useTopDeck();
  const { walletKind } = td.wallet;
  const copied = td.state.addressCopied;
  const action = (label: string, onClick: () => void, danger = false): ReactNode => (
    <div
      onClick={onClick}
      style={{ fontSize: 12.5, fontWeight: 700, padding: '9px 12px', borderRadius: 8, border: `2px solid ${INK}`, background: danger ? '#ff4d3d' : '#fff', color: danger ? '#fff' : INK, cursor: 'pointer', textAlign: 'center' }}
    >
      {label}
    </div>
  );
  return (
    <>
      {/* click-outside backdrop */}
      <div onClick={td.closeWalletMenu} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 41, width: 260, background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', background: '#ffd84d', borderBottom: `3px solid ${INK}` }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.6)' }}>CONNECTED WALLET</span>
          <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: INK, color: '#fff' }}>
            {walletKind === 'passkey' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <BoltIcon sx={{ fontSize: 13, color: '#ffd84d' }} />
                <span>Passkey</span>
              </span>
            ) : (
              'Classic'
            )}
          </span>
        </div>
        <div style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div
            onClick={td.copyAddress}
            title="Click to copy"
            style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12, fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.5, padding: '9px 11px', background: '#fff7ec', border: `2px solid ${INK}`, borderRadius: 8, cursor: 'pointer' }}
          >
            {address}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {action(copied ? '✓ Copied' : 'Copy', td.copyAddress)}
            {action('Explorer ↗', () => window.open(td.explorerAddress(address), '_blank', 'noopener,noreferrer'))}
          </div>
          {action('Disconnect', td.disconnectWallet, true)}
        </div>
      </div>
    </>
  );
}

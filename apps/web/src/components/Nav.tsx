'use client';

import Link from 'next/link';
import { useWallet } from './WalletProvider';

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Nav() {
  const { address, connect, disconnect, connecting } = useWallet();

  return (
    <header
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <div
        className="container"
        style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '0.9rem 1.5rem' }}
      >
        <Link href="/" style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1.1rem' }}>
          ✦ StellarCards
        </Link>
        <nav style={{ display: 'flex', gap: '1rem', flex: 1 }}>
          <Link href="/">Market</Link>
          <Link href="/sell">Sell</Link>
          <Link href="/trades">Trades</Link>
        </nav>
        <span className="badge">testnet</span>
        {address ? (
          <button className="secondary" onClick={disconnect} title={address}>
            {shorten(address)} · disconnect
          </button>
        ) : (
          <button onClick={connect} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        )}
      </div>
    </header>
  );
}

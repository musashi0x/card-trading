'use client';

import ShieldIcon from '@mui/icons-material/Shield';

export default function Maintenance() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: '#fff7ec'
    }}>
      <div style={{
        maxWidth: 520,
        width: '100%',
        background: '#fff',
        border: '3px solid #1a1305',
        borderRadius: 20,
        padding: '40px 30px',
        boxShadow: '6px 6px 0 #1a1305',
        textAlign: 'center'
      }}>
        {/* Shield Icon Graphic */}
        <div style={{
          width: 70,
          height: 70,
          borderRadius: 12,
          background: '#ffd84d',
          border: '3px solid #1a1305',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 28px',
          boxShadow: '4px 4px 0 #1a1305',
          transform: 'rotate(-3deg)'
        }}>
          <ShieldIcon sx={{ fontSize: 40, color: '#1a1305' }} />
        </div>

        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 900,
          fontSize: 34,
          letterSpacing: '-.02em',
          margin: '0 0 12px',
          color: '#1a1305'
        }}>
          Arena Maintenance
        </h1>
        <p style={{
          fontSize: 14.5,
          color: 'rgba(26,19,5,.6)',
          lineHeight: 1.5,
          fontWeight: 500,
          margin: '0 0 24px'
        }}>
          We are currently upgrading the settlement contract and indexing new ledger transactions. The arena will be back online in a few minutes.
        </p>

        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          fontWeight: 800,
          background: '#bff3d4',
          color: '#0a5e34',
          padding: '8px 16px',
          borderRadius: 8,
          border: '2px solid #1a1305',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0a5e34', animation: 'pulseDot 1.3s infinite' }} />
          CONTRACT UPGRADE IN PROGRESS
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Error:', error);
  }, [error]);

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
        maxWidth: 480,
        width: '100%',
        background: '#fff',
        border: '3px solid #1a1305',
        borderRadius: 20,
        padding: '40px 30px',
        boxShadow: '6px 6px 0 #1a1305',
        textAlign: 'center'
      }}>
        {/* Mock Glitched Card Graphic */}
        <div style={{
          width: 130,
          height: 180,
          background: '#ff4d3d',
          border: '3px solid #1a1305',
          borderRadius: 14,
          margin: '0 auto 28px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          transform: 'rotate(3deg)',
          boxShadow: '4px 4px 0 #1a1305'
        }}>
          <span style={{
            fontSize: 48,
            fontWeight: 800,
            color: '#fff',
            fontFamily: "'Bricolage Grotesque', sans-serif"
          }}>⚡</span>
          <div style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            right: 12,
            background: '#fff',
            border: '2px solid #1a1305',
            borderRadius: 6,
            padding: '3px 0',
            fontSize: 9,
            fontWeight: 800,
            color: '#1a1305',
            fontFamily: "'Bricolage Grotesque', sans-serif"
          }}>
            SYSTEM FAULT
          </div>
        </div>

        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 900,
          fontSize: 34,
          letterSpacing: '-.02em',
          margin: '0 0 12px',
          color: '#1a1305'
        }}>
          500: Smart Fault
        </h1>
        <p style={{
          fontSize: 14,
          color: 'rgba(26,19,5,.6)',
          lineHeight: 1.5,
          fontWeight: 500,
          margin: '0 0 30px'
        }}>
          A transaction cycle encountered an unexpected error on-chain or off-chain. Let's try reloading the arena.
        </p>

        <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
          <button
            onClick={() => reset()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'Bricolage Grotesque', sans-serif",
              fontWeight: 800,
              fontSize: 15,
              padding: '14px 28px',
              background: '#ff4d3d',
              color: '#fff',
              border: '3px solid #1a1305',
              borderRadius: 12,
              boxShadow: '4px 4px 0 #1a1305',
              cursor: 'pointer',
              transition: 'transform 0.1s ease'
            }}
            className="td-lift"
          >
            Retry Action
          </button>
          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'Bricolage Grotesque', sans-serif",
              fontWeight: 800,
              fontSize: 15,
              padding: '14px 28px',
              background: '#fff',
              color: '#1a1305',
              border: '3px solid #1a1305',
              borderRadius: 12,
              boxShadow: '4px 4px 0 #1a1305',
              cursor: 'pointer',
              transition: 'transform 0.1s ease',
              textDecoration: 'none'
            }}
            className="td-lift"
          >
            Go Home
          </a>
        </div>
      </div>
    </div>
  );
}

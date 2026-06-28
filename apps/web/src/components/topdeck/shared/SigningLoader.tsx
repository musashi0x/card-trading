'use client';

import { useTopDeck } from '../TopDeckProvider';
import { DISPLAY, INK } from '../theme';

/**
 * Global signature waiting loader screen.
 * Shows when an on-chain transaction is waiting for user signature in their wallet.
 */
export function SigningLoader() {
  const td = useTopDeck();
  const st = td.state;

  const isSigning = st.publishing || st.paying || st.bidBusy || !!st.orderBusy;

  if (!isSigning) return null;

  // Context-aware signing status messages
  let message = 'Please approve the transaction in your connected wallet.';
  if (st.publishing) {
    message = 'Signing transaction to mint your card and publish the listing...';
  } else if (st.paying) {
    message = 'Signing transaction to authorize payment and lock funds in escrow...';
  } else if (st.bidBusy) {
    message = 'Signing transaction to place your bid or update the auction state...';
  } else if (st.orderBusy) {
    message = 'Signing transaction to execute the order action on-chain...';
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(26,19,5,.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'overlayIn .15s ease both' }}>
      <style>{`
        @keyframes cardFlip {
          0% { transform: rotateY(0deg) scale(1); }
          50% { transform: rotateY(180deg) scale(1.05); }
          100% { transform: rotateY(360deg) scale(1); }
        }
        @keyframes textPulse {
          0%, 100% { opacity: 0.75; }
          50% { opacity: 1; }
        }
      `}</style>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff7ec', border: `3.5px solid ${INK}`, borderRadius: 20, boxShadow: `8px 8px 0 ${INK}`, padding: '36px 24px', textAlign: 'center', animation: 'modalIn .25s cubic-bezier(.2,.9,.3,1.3) both', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        {/* 3D Flipping trading card spinner */}
        <div style={{ perspective: 600 }}>
          <div style={{ width: 64, height: 88, borderRadius: 10, border: `3px solid ${INK}`, background: 'linear-gradient(135deg, #ff4d3d, #ffd84d)', boxShadow: `3px 3px 0 ${INK}`, animation: 'cardFlip 1.8s infinite ease-in-out' }} />
        </div>

        {/* Text Details */}
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 21, color: INK, letterSpacing: '-.02em' }}>
            Confirm Signature 🔑
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Waiting for wallet
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, marginTop: 14, lineHeight: 1.45, animation: 'textPulse 1.5s infinite ease-in-out' }}>
            {message}
          </div>
        </div>

        {/* Helper Hint */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(26,19,5,.4)', borderTop: `1.5px solid rgba(26,19,5,.1)`, paddingTop: 16, width: '100%', lineHeight: 1.4 }}>
          Please check your browser extension, phone prompt, or Face ID window to authorize the request.
        </div>
      </div>
    </div>
  );
}

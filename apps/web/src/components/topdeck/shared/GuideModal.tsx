'use client';

import { useState } from 'react';
import { useTopDeck } from '../TopDeckProvider';
import { DISPLAY, INK } from '../theme';
import BoltIcon from '@mui/icons-material/Bolt';
import ShieldIcon from '@mui/icons-material/Shield';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import GavelIcon from '@mui/icons-material/Gavel';

interface Slide {
  title: string;
  subtitle: string;
  description: React.ReactNode;
  visual: React.ReactNode;
}

export function GuideModal() {
  const td = useTopDeck();
  const st = td.state;
  const [step, setStep] = useState(0);

  if (!st.guideOpen) return null;

  const slides: Slide[] = [
    {
      title: 'Welcome to TopDeck 🃏',
      subtitle: 'The Stellar-powered trading card arena',
      description: (
        <div style={{ fontSize: 14.5, color: 'rgba(26,19,5,.75)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0 }}>
            TopDeck is a premium, non-custodial marketplace for trading cards and collectibles. Build, trade, and auction your collection with 100% on-chain security.
          </p>
          <p style={{ margin: 0, fontWeight: 700, color: INK }}>
            ✨ No middlemen · Gas-free transactions · Real-world safety
          </p>
        </div>
      ),
      visual: (
        <div style={{ height: 160, borderRadius: 14, border: `2.5px solid ${INK}`, background: 'linear-gradient(135deg, #ff4d3d, #ffd84d)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: `4px 4px 0 ${INK}`, color: '#fff', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -20, left: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
          <div style={{ position: 'absolute', bottom: -10, right: -10, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ position: 'absolute', top: 12, left: 12, fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: INK, border: `1.5px solid #fff`, color: '#fff' }}>GEMINI 1ST ED</div>
          <AutoAwesomeIcon sx={{ fontSize: 44, filter: 'drop-shadow(2px 2px 0 rgba(0,0,0,0.15))' }} />
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginTop: 8, letterSpacing: '-.02em', textShadow: '1px 1px 0 rgba(0,0,0,0.2)' }}>Solar Drake · #006</div>
        </div>
      ),
    },
    {
      title: 'Protected Escrow Delivery 📦',
      subtitle: 'Two ways to settle purchases on-chain',
      description: (
        <div style={{ fontSize: 14, color: 'rgba(26,19,5,.75)', lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ padding: '6px 8px', borderRadius: 8, background: '#ff4d3d', color: '#fff', border: `1.5px solid ${INK}` }}>
              <BoltIcon sx={{ fontSize: 16 }} />
            </div>
            <div>
              <strong style={{ color: INK }}>Digital (Instant Transfer)</strong>
              <div style={{ fontSize: 12.5, color: 'rgba(26,19,5,.6)', marginTop: 2 }}>Card token transfers instantly to the buyer. Best for digital-only cards.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ padding: '6px 8px', borderRadius: 8, background: '#13c06a', color: '#fff', border: `1.5px solid ${INK}` }}>
              <ShieldIcon sx={{ fontSize: 16 }} />
            </div>
            <div>
              <strong style={{ color: INK }}>Physical (Escrow Protected)</strong>
              <div style={{ fontSize: 12.5, color: 'rgba(26,19,5,.6)', marginTop: 2 }}>Funds are locked in a Stellar smart contract. The buyer confirms receipt of the physical card before payment is released.</div>
            </div>
          </div>
        </div>
      ),
      visual: (
        <div style={{ height: 160, display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ flex: 1, height: '100%', borderRadius: 14, border: `2.5px solid ${INK}`, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: `3px 3px 0 ${INK}`, padding: 12 }}>
            <BoltIcon sx={{ fontSize: 28, color: '#ff4d3d', marginBottom: 4 }} />
            <div style={{ fontSize: 12, fontWeight: 800 }}>INSTANT</div>
            <div style={{ fontSize: 10, color: 'rgba(26,19,5,.5)', fontWeight: 600, textAlign: 'center', marginTop: 4 }}>Immediate token swap</div>
          </div>
          <div style={{ flex: 1, height: '100%', borderRadius: 14, border: `2.5px solid ${INK}`, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: `3px 3px 0 ${INK}`, padding: 12 }}>
            <ShieldIcon sx={{ fontSize: 28, color: '#13c06a', marginBottom: 4 }} />
            <div style={{ fontSize: 12, fontWeight: 800 }}>ESCROW</div>
            <div style={{ fontSize: 10, color: 'rgba(26,19,5,.5)', fontWeight: 600, textAlign: 'center', marginTop: 4 }}>Arbiter protected shipping</div>
          </div>
        </div>
      ),
    },
    {
      title: 'Smart Wallets & Swaps 🔑',
      subtitle: 'Frictionless payments for everyone',
      description: (
        <div style={{ fontSize: 14, color: 'rgba(26,19,5,.75)', lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: INK }}>Gas-Free Passkeys:</strong> Log in and authorize trades using Face ID or Touch ID. No browser extensions, seed phrases, or gas fees needed.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: INK }}>Pay with Any Asset:</strong> Bid or buy using USDC, XLM, or any Stellar token. Our smart contracts perform on-chain path payments to convert your assets automatically.
          </p>
        </div>
      ),
      visual: (
        <div style={{ height: 160, borderRadius: 14, border: `2.5px solid ${INK}`, background: '#ffd84d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: `4px 4px 0 ${INK}`, position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, border: `2px solid ${INK}`, background: '#fff', borderRadius: 8, padding: '6px 12px' }}>$XLM</div>
            <span style={{ fontSize: 18, fontWeight: 800 }}>⇄</span>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, border: `2px solid ${INK}`, background: '#fff', borderRadius: 8, padding: '6px 12px' }}>$USDC</div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 6, background: INK, color: '#fff', marginTop: 12 }}>
            <BoltIcon sx={{ fontSize: 13 }} />
            <span>Face ID Enabled</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Creator Royalties 🎨',
      subtitle: 'Empowering artists and creators',
      description: (
        <div style={{ fontSize: 14.5, color: 'rgba(26,19,5,.75)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0 }}>
            Every card minted on TopDeck can include an optional creator royalty (up to 10%).
          </p>
          <p style={{ margin: 0 }}>
            Whenever a card is resold, the settlement contract splits the payment three ways, immediately sending the royalty directly to the creator's wallet in the same transaction.
          </p>
        </div>
      ),
      visual: (
        <div style={{ height: 160, borderRadius: 14, border: `2.5px solid ${INK}`, background: 'linear-gradient(135deg, #7c3aed, #c084fc)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: `4px 4px 0 ${INK}`, color: '#fff' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(255,255,255,0.15)', padding: '8px 16px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.3)' }}>
            <EmojiEventsIcon sx={{ fontSize: 20 }} />
            <span style={{ fontSize: 14, fontWeight: 800 }}>10% Creator Royalty Enforced</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginTop: 8 }}>Atomic settlement split on resale</div>
        </div>
      ),
    },
  ];

  const current = (slides[step] || slides[0]) as Slide;
  const isLast = step === slides.length - 1;

  const handleNext = () => {
    if (isLast) {
      td.closeGuide();
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div onClick={td.closeGuide} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,19,5,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'overlayIn .15s ease both' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 500, background: '#fff7ec', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `8px 8px 0 ${INK}`, padding: 28, animation: 'modalIn .22s cubic-bezier(.2,.9,.3,1.3) both', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, letterSpacing: '-.02em', color: INK }}>{current.title}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 2 }}>{current.subtitle}</div>
          </div>
          <div onClick={td.closeGuide} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `2.5px solid ${INK}`, background: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>✕</div>
        </div>

        {/* graphic representation */}
        {current.visual}

        {/* description */}
        <div style={{ minHeight: 110 }}>
          {current.description}
        </div>

        {/* controls footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <div>
            {step > 0 ? (
              <div onClick={handleBack} style={{ fontSize: 13, fontWeight: 800, padding: '10px 18px', border: `2.5px solid ${INK}`, borderRadius: 10, background: '#fff', color: INK, cursor: 'pointer' }}>Back</div>
            ) : (
              <div onClick={td.closeGuide} style={{ fontSize: 13, fontWeight: 800, padding: '10px 18px', color: 'rgba(26,19,5,.45)', cursor: 'pointer' }}>Skip</div>
            )}
          </div>

          {/* dot indicators */}
          <div style={{ display: 'flex', gap: 7 }}>
            {slides.map((_, i) => (
              <div key={i} onClick={() => setStep(i)} style={{ width: 8, height: 8, borderRadius: '50%', border: `1.5px solid ${INK}`, background: i === step ? '#ff4d3d' : '#e7ddc8', cursor: 'pointer', transition: 'background-color .15s' }} />
            ))}
          </div>

          <div onClick={handleNext} style={{ fontSize: 13, fontWeight: 800, padding: '10px 22px', border: `2.5px solid ${INK}`, borderRadius: 10, background: isLast ? '#13c06a' : '#ff4d3d', color: '#fff', cursor: 'pointer', boxShadow: `3.5px 3.5px 0 ${INK}`, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{isLast ? 'Get started!' : 'Next'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { DISPLAY, INK, SANS } from '@/components/topdeck/theme';
import { CardTile } from '@/components/topdeck/shared/CardTile';
import Link from 'next/link';
import BoltIcon from '@mui/icons-material/Bolt';
import ShieldIcon from '@mui/icons-material/Shield';
import GavelIcon from '@mui/icons-material/Gavel';
import TimerIcon from '@mui/icons-material/Timer';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import StarIcon from '@mui/icons-material/Star';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';

export default function LandingPage() {
  const td = useTopDeck();
  const st = td.state;

  // Derive stats from active listings
  const liveCount = st.cards.length;
  const auctionCount = st.cards.filter((c) => c.isAuction).length;
  const fixedCount = st.cards.filter((c) => !c.isAuction).length;

  // Grab up to 3 featured cards for showcase
  const featuredCards = st.cards.slice(0, 3);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal-active');
          }
        });
      },
      {
        threshold: 0.08,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    const elements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-zoom');
    elements.forEach((el) => observer.observe(el));

    // Instantly reveal elements that are already above/in the viewport
    setTimeout(() => {
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
          el.classList.add('reveal-active');
        }
      });
    }, 100);

    return () => {
      elements.forEach((el) => observer.unobserve(el));
    };
  }, []);

  return (
    <div className="m-pad" style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 32px 100px' }}>

      {/* 1. HERO SECTION */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'center', marginBottom: 80, minHeight: '480px' }} className="stack">
        <div className="reveal reveal-left" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#ff4d3d', letterSpacing: '.04em' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d3d', animation: 'pulseDot 1.3s infinite' }} />
            STELLAR-POWERED CARD ARENA
          </div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 52, letterSpacing: '-.02em', margin: 0, lineHeight: 1.05, color: INK }}>
            The trustless <br />
            <span style={{ color: '#2d5bff' }}>trading card</span> arena.
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(26,19,5,.7)', fontWeight: 500, lineHeight: 1.5, margin: 0, maxWidth: 500 }}>
            StellarCards is a premium, non-custodial marketplace where cards are on-chain assets and every trade settles atomically via Soroban escrow. The payment flow is the product.
          </p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              onClick={td.goBrowse}
              style={{
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 16,
                padding: '16px 30px',
                background: '#ff4d3d',
                color: '#fff',
                border: `3px solid ${INK}`,
                borderRadius: 12,
                boxShadow: `4px 4px 0 ${INK}`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'transform 0.1s ease',
              }}
              className="td-lift"
            >
              <span>Explore Auctions</span>
              <ArrowForwardIcon sx={{ fontSize: 18 }} />
            </button>
            <button
              onClick={td.goSell}
              style={{
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 16,
                padding: '16px 26px',
                background: '#fff',
                color: INK,
                border: `3px solid ${INK}`,
                borderRadius: 12,
                boxShadow: `4px 4px 0 ${INK}`,
                cursor: 'pointer',
              }}
              className="td-lift"
            >
              List a Card
            </button>
          </div>

          {/* Real-time stats */}
          <div style={{ display: 'flex', gap: 24, marginTop: 15, borderTop: `2px solid rgba(26,19,5,.1)`, paddingTop: 20 }}>
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, color: INK }}>{liveCount}</div>
              <div style={{ fontSize: 12, color: 'rgba(26,19,5,.5)', fontWeight: 700 }}>Live Lots</div>
            </div>
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, color: INK }}>{auctionCount}</div>
              <div style={{ fontSize: 12, color: 'rgba(26,19,5,.5)', fontWeight: 700 }}>Auctions</div>
            </div>
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, color: INK }}>{fixedCount}</div>
              <div style={{ fontSize: 12, color: 'rgba(26,19,5,.5)', fontWeight: 700 }}>Fixed Price</div>
            </div>
          </div>
        </div>

        {/* Hero Visual Block */}
        <div className="reveal reveal-right" style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {/* Background element */}
          <div style={{ position: 'absolute', width: '80%', height: '80%', background: '#ffd84d', border: `3px solid ${INK}`, borderRadius: 20, transform: 'rotate(-3deg)', zIndex: 1 }} />

          {/* Active Card Stack */}
          <div className="hero-float" style={{ position: 'relative', zIndex: 2, display: 'flex', gap: 16, transform: 'rotate(2deg)' }}>
            {featuredCards.length > 0 ? (
              featuredCards.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    transform: `translateY(${i * 12}px) rotate(${(i - 1) * 4}deg)`,
                    boxShadow: '10px 10px 0 rgba(26,19,5,0.15)'
                  }}
                >
                  <CardTile card={c} height={190} />
                </div>
              ))
            ) : (
              // Fallback cards if no live listings loaded
              <>
                <div style={{ width: 150, height: 210, borderRadius: 14, border: `3px solid ${INK}`, background: 'linear-gradient(135deg, #ff4d3d, #ffd84d)', padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#fff', transform: 'rotate(-6deg)' }}>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', background: INK, border: '1.5px solid #fff', borderRadius: 4, width: 'fit-content' }}>LEGENDARY</span>
                  <div style={{ fontSize: 14, fontWeight: 800, fontFamily: DISPLAY }}>Solar Drake</div>
                </div>
                <div style={{ width: 150, height: 210, borderRadius: 14, border: `3px solid ${INK}`, background: 'linear-gradient(135deg, #7c3aed, #c084fc)', padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#fff', transform: 'translateY(-10px) rotate(2deg)' }}>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', background: INK, border: '1.5px solid #fff', borderRadius: 4, width: 'fit-content' }}>EPIC</span>
                  <div style={{ fontSize: 14, fontWeight: 800, fontFamily: DISPLAY }}>Cyber Mech</div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* 2. THE TRUST GAP COMPARISON */}
      <section style={{ marginBottom: 80 }}>
        <div className="reveal reveal-zoom" style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, letterSpacing: '-.02em', margin: 0 }}>Bridging the Peer-to-Peer Trust Gap</h2>
          <p style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', fontWeight: 600, marginTop: 8 }}>Traditional marketplaces lock you into platform risk. We settle trustlessly on-chain.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }} className="stack">
          {/* Legacy way */}
          <div className="reveal reveal-left" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, padding: 30, boxShadow: `5px 5px 0 ${INK}` }}>
            <div style={{ display: 'inline-flex', fontSize: 12, fontWeight: 800, background: '#ffd1cc', color: '#a3160a', padding: '6px 12px', borderRadius: 8, border: `2px solid ${INK}`, marginBottom: 18 }}>THE OLD WAY ❌</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <strong style={{ fontSize: 15, color: INK }}>Custodial Middlemen</strong>
                <p style={{ fontSize: 13, color: 'rgba(26,19,5,.6)', margin: '4px 0 0', lineHeight: 1.4 }}>Marketplaces hold your money and cards, taking massive cuts and exposing you to counterparty/platform risk.</p>
              </div>
              <div style={{ borderTop: '1.5px solid rgba(26,19,5,.08)', paddingTop: 14 }}>
                <strong style={{ fontSize: 15, color: INK }}>Opaque, Slow & Expensive</strong>
                <p style={{ fontSize: 13, color: 'rgba(26,19,5,.6)', margin: '4px 0 0', lineHeight: 1.4 }}>Payment processors charge 10–20% in combined fees, with settlement taking days and no on-chain proof of ownership transfer.</p>
              </div>
              <div style={{ borderTop: '1.5px solid rgba(26,19,5,.08)', paddingTop: 14 }}>
                <strong style={{ fontSize: 15, color: INK }}>High Payment Friction</strong>
                <p style={{ fontSize: 13, color: 'rgba(26,19,5,.6)', margin: '4px 0 0', lineHeight: 1.4 }}>Crypto platforms force you to sign confusing ledger actions, hold gas tokens, and manage vulnerable seed phrases.</p>
              </div>
            </div>
          </div>

          {/* StellarCards way */}
          <div className="reveal reveal-right" style={{ background: '#ffd84d', border: `3px solid ${INK}`, borderRadius: 18, padding: 30, boxShadow: `5px 5px 0 ${INK}` }}>
            <div style={{ display: 'inline-flex', fontSize: 12, fontWeight: 800, background: '#bff3d4', color: '#0a5e34', padding: '6px 12px', borderRadius: 8, border: `2px solid ${INK}`, marginBottom: 18 }}>THE STELLARCARDS WAY ✨</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <strong style={{ fontSize: 15, color: INK }}>Atomic, Non-Custodial Settlement</strong>
                <p style={{ fontSize: 13, color: 'rgba(26,19,5,.75)', margin: '4px 0 0', lineHeight: 1.4 }}>Contracts lock card and payment in escrow. They exchange together atomically or not at all. No middleman holds the funds.</p>
              </div>
              <div style={{ borderTop: '2px solid rgba(26,19,5,.15)', paddingTop: 14 }}>
                <strong style={{ fontSize: 15, color: INK }}>Fair Economics & Open Proof</strong>
                <p style={{ fontSize: 13, color: 'rgba(26,19,5,.75)', margin: '4px 0 0', lineHeight: 1.4 }}>Settlements occur in seconds on-chain with low flat fees. Secondary royalties are split instantly back to original creators.</p>
              </div>
              <div style={{ borderTop: '2px solid rgba(26,19,5,.15)', paddingTop: 14 }}>
                <strong style={{ fontSize: 15, color: INK }}>Consumer-Grade Checkout</strong>
                <p style={{ fontSize: 13, color: 'rgba(26,19,5,.75)', margin: '4px 0 0', lineHeight: 1.4 }}>Transact via Face ID/Touch ID with Passkey smart accounts. Gasless transactions sponsor fees, and buyers can pay with any Stellar asset.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. ATOMIC WORKFLOW DIAGRAM */}
      <section className="reveal" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, padding: '40px 30px', marginBottom: 80, boxShadow: `6px 6px 0 ${INK}` }}>
        <div style={{ textAlign: 'center', marginBottom: 35 }}>
          <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, letterSpacing: '-.02em', margin: 0 }}>How It Works: Atomic Escrow</h2>
          <p style={{ fontSize: 13.5, color: 'rgba(26,19,5,.55)', fontWeight: 600, marginTop: 6 }}>Soroban smart contracts protect both buyers and sellers in a single transaction cycle.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center', gap: 15 }} className="stack">

          {/* Step 1 */}
          <div className="reveal reveal-left stagger-1" style={{ border: `2.5px solid ${INK}`, borderRadius: 12, padding: 18, background: '#ffd84d', textAlign: 'center', minHeight: 140, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: INK, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, margin: '0 auto 8px' }}>1</div>
            <strong style={{ fontSize: 13.5, display: 'block', color: INK }}>List Card</strong>
            <span style={{ fontSize: 12, color: 'rgba(26,19,5,.75)', display: 'block', marginTop: 4 }}>Seller lists card on-chain. Card wrapped asset is locked into settlement contract.</span>
          </div>

          {/* Arrow */}
          <div className="reveal reveal-zoom stagger-2 m-hide" style={{ fontSize: 24, fontWeight: 900, color: INK, textAlign: 'center', transform: 'rotate(0deg)' }}>➔</div>

          {/* Step 2 */}
          <div className="reveal reveal-zoom stagger-3" style={{ border: `2.5px solid ${INK}`, borderRadius: 12, padding: 18, background: '#2d5bff', color: '#fff', textAlign: 'center', minHeight: 140, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', color: '#2d5bff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, margin: '0 auto 8px' }}>2</div>
            <strong style={{ fontSize: 13.5, display: 'block' }}>Escrow Funds</strong>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,.9)', display: 'block', marginTop: 4 }}>Buyer places bid or buys. USDC/XLM purchase amount is held in smart escrow.</span>
          </div>

          {/* Arrow */}
          <div className="reveal reveal-zoom stagger-4 m-hide" style={{ fontSize: 24, fontWeight: 900, color: INK, textAlign: 'center' }}>➔</div>

          {/* Step 3 */}
          <div className="reveal reveal-right stagger-5" style={{ border: `2.5px solid ${INK}`, borderRadius: 12, padding: 18, background: '#13c06a', color: '#fff', textAlign: 'center', minHeight: 140, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', color: '#13c06a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, margin: '0 auto 8px' }}>3</div>
            <strong style={{ fontSize: 13.5, display: 'block' }}>Atomic Release</strong>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,.9)', display: 'block', marginTop: 4 }}>On accept/delivery, card transfers to buyer & split payment releases to seller and creator.</span>
          </div>

        </div>
      </section>

      {/* 4. STELLAR INTEGRATION DEEP DIVE */}
      <section style={{ marginBottom: 80 }}>
        <div className="reveal reveal-zoom" style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, letterSpacing: '-.02em', margin: 0 }}>Built Natively on Stellar</h2>
          <p style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', fontWeight: 600, marginTop: 8 }}>Deep protocol integrations provide safety, speed, and Web2-like checkout.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }} className="stack">
          {/* Card 1 */}
          <div className="reveal reveal-zoom stagger-1" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, padding: 22, boxShadow: `4px 4px 0 ${INK}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#ffd84d', border: `2px solid ${INK}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }}>
              <GavelIcon sx={{ fontSize: 20 }} />
            </div>
            <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, margin: '0 0 8px' }}>Soroban Escrow Contract</h3>
            <p style={{ fontSize: 12.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.45, margin: 0 }}>One unified contract written in Rust handles listings, offers, auctions, swaps, and physical-delivery escrows atomically.</p>
          </div>

          {/* Card 2 */}
          <div className="reveal reveal-zoom stagger-2" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, padding: 22, boxShadow: `4px 4px 0 ${INK}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#ff4d3d', border: `2px solid ${INK}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 15 }}>
              <BoltIcon sx={{ fontSize: 20 }} />
            </div>
            <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, margin: '0 0 8px' }}>Passkey Smart Wallets</h3>
            <p style={{ fontSize: 12.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.45, margin: 0 }}>Deploy smart accounts on first use and authorize transactions via Face ID/Touch ID biometrics (secp256r1/WebAuthn). No seeds.</p>
          </div>

          {/* Card 3 */}
          <div className="reveal reveal-zoom stagger-3" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, padding: 22, boxShadow: `4px 4px 0 ${INK}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#2d5bff', border: `2px solid ${INK}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 15 }}>
              <AccountBalanceWalletIcon sx={{ fontSize: 20 }} />
            </div>
            <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, margin: '0 0 8px' }}>Launchtube Gasless Relay</h3>
            <p style={{ fontSize: 12.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.45, margin: 0 }}>Transactions are relayed and gas fees sponsored, so collectors never need to buy or hold XLM tokens just to cover fees.</p>
          </div>

          {/* Card 4 */}
          <div className="reveal reveal-zoom stagger-4" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, padding: 22, boxShadow: `4px 4px 0 ${INK}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#7c3aed', border: `2px solid ${INK}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 15 }}>
              <SwapHorizIcon sx={{ fontSize: 20 }} />
            </div>
            <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, margin: '0 0 8px' }}>DEX Path Payments</h3>
            <p style={{ fontSize: 12.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.45, margin: 0 }}>Buyers pay in XLM or any classic asset, while Horizon pathfinding converts assets on-chain so the seller receives USDC.</p>
          </div>

          {/* Card 5 */}
          <div className="reveal reveal-zoom stagger-5" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, padding: 22, boxShadow: `4px 4px 0 ${INK}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#13c06a', border: `2px solid ${INK}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 15 }}>
              <AutoAwesomeIcon sx={{ fontSize: 20 }} />
            </div>
            <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, margin: '0 0 8px' }}>On-Chain Royalties</h3>
            <p style={{ fontSize: 12.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.45, margin: 0 }}>Minter addresses and royalty percentage rates are recorded on-chain, triggering automatic split payments on resales.</p>
          </div>

          {/* Card 6 */}
          <div className="reveal reveal-zoom stagger-6" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, padding: 22, boxShadow: `4px 4px 0 ${INK}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#fff', border: `2px solid ${INK}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK, marginBottom: 15 }}>
              <LocalShippingIcon sx={{ fontSize: 20 }} />
            </div>
            <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, margin: '0 0 8px' }}>Physical-Card Escrow</h3>
            <p style={{ fontSize: 12.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.45, margin: 0 }}>Ship with confidence. Funds are locked in escrow and only released to the seller after the buyer confirms safe delivery.</p>
          </div>
        </div>
      </section>

      {/* 5. AUDIENCE SECTIONS */}
      <section style={{ marginBottom: 80 }}>
        <div className="reveal reveal-zoom" style={{ textAlign: 'center', marginBottom: 45 }}>
          <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, letterSpacing: '-.02em', margin: 0 }}>Built for the Entire Ecosystem</h2>
          <p style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', fontWeight: 600, marginTop: 8 }}>From collectors to merchant storefronts and secondary market creators.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }} className="stack">
          {/* Card Creators */}
          <div className="reveal reveal-left stagger-1" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, padding: 26, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#7c3aed', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `2px solid ${INK}` }}>
              <AutoAwesomeIcon />
            </div>
            <div>
              <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, margin: '0 0 6px', color: INK }}>Creators &amp; Brands</h3>
              <p style={{ fontSize: 13.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.5, margin: 0 }}>
                Originate unique digital cards with built-in, immutable royalties. Earn passive secondary sales revenue directly into your account on every single resale.
              </p>
            </div>
          </div>

          {/* Collectors */}
          <div className="reveal reveal-right stagger-2" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, padding: 26, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#ffd84d', color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `2px solid ${INK}` }}>
              <StarIcon />
            </div>
            <div>
              <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, margin: '0 0 6px', color: INK }}>Collectors &amp; Traders</h3>
              <p style={{ fontSize: 13.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.5, margin: 0 }}>
                Enjoy actual digital ownership. Swap card-for-card with atomic barter, or list items in english timed auctions with anti-snipe bidding protection.
              </p>
            </div>
          </div>

          {/* Mainstream buyers */}
          <div className="reveal reveal-left stagger-3" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, padding: 26, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#ff4d3d', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `2px solid ${INK}` }}>
              <BoltIcon />
            </div>
            <div>
              <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, margin: '0 0 6px', color: INK }}>Crypto-Curious Buyers</h3>
              <p style={{ fontSize: 13.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.5, margin: 0 }}>
                Checkout as easily as any Web2 storefront. Sign transactions biometrically via device Face ID/Touch ID smart-wallets. No gas tokens or setup friction.
              </p>
            </div>
          </div>

          {/* Merchants & Physical sellers */}
          <div className="reveal reveal-right stagger-4" style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, padding: 26, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#13c06a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `2px solid ${INK}` }}>
              <ShieldIcon />
            </div>
            <div>
              <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, margin: '0 0 6px', color: INK }}>Physical Sellers &amp; Shops</h3>
              <p style={{ fontSize: 13.5, color: 'rgba(26,19,5,.6)', lineHeight: 1.5, margin: 0 }}>
                Eliminate chargeback and settlement risk. Escrow protection holds client payments on-chain until items arrive, resolving trades cleanly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. CALL TO ACTION SECTION */}
      <section className="reveal reveal-zoom" style={{ background: '#ff4d3d', border: `3.5px solid ${INK}`, borderRadius: 20, padding: '50px 30px', textAlign: 'center', color: '#fff', boxShadow: `8px 8px 0 ${INK}` }}>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 40, letterSpacing: '-.02em', margin: 0, textShadow: '2px 2px 0 rgba(0,0,0,0.1)' }}>Ready to Enter the Arena?</h2>
        <p style={{ fontSize: 16, maxWidth: 500, margin: '15px auto 25px', lineHeight: 1.5, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>
          Browse open lots, place on-chain bids, or list your cards in minutes. Connect your Freighter or passkey wallet and start trading.
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
          <button
            onClick={td.goBrowse}
            style={{
              fontFamily: DISPLAY,
              fontWeight: 800,
              fontSize: 16,
              padding: '16px 36px',
              background: '#ffd84d',
              color: INK,
              border: `3px solid ${INK}`,
              borderRadius: 12,
              boxShadow: `4px 4px 0 ${INK}`,
              cursor: 'pointer',
            }}
          >
            Launch Marketplace
          </button>
        </div>
      </section>

    </div>
  );
}

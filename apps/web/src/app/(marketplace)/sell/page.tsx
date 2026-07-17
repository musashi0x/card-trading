'use client';

import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { INK, DISPLAY, SANS } from '@/components/topdeck/theme';
import BoltIcon from '@mui/icons-material/Bolt';
import ShieldIcon from '@mui/icons-material/Shield';
import CelebrationIcon from '@mui/icons-material/Celebration';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import GavelIcon from '@mui/icons-material/Gavel';
import TimerIcon from '@mui/icons-material/Timer';
import { money, rarityMeta, rarityArt, mapRarity } from '@/components/topdeck/lib';
import { chipStyle } from '@/components/topdeck/shared/CardTile';
import type { Rarity } from '@/components/topdeck/lib';

export default function SellPage() {
  const td = useTopDeck();
  const st = td.state;
  const f = st.form;
  const fileInput = useRef<HTMLInputElement | null>(null);

  const rm = rarityMeta(f.rarity);
  const startN = Number(f.startBid) || 0;
  const buyN = Number(f.buyNow) || 0;
  const durLabel = f.duration === 1 ? '1 day' : f.duration + ' days';
  // Hold mode needs a selected card; mint mode needs a name + photo to issue one.
  const step1Valid = st.sellMode === 'mint' ? f.title.trim().length > 0 && !!f.image : !!f.cardId;
  const reserveN = Number(f.reserve) || 0;
  const isAuction = f.listingType === 'auction';
  const step2Valid =
    startN > 0 &&
    (!f.graded || (f.grade || '').trim().length > 0) &&
    (isAuction
      ? f.duration > 0 && (reserveN === 0 || reserveN >= startN)
      : !f.buyNowOn || buyN > startN);
  const previewArt = f.image ? `center/cover no-repeat url("${f.image}")` : rarityArt(f.rarity);
  const chip = (active: boolean, label: ReactNode, onClick: () => void, key?: string | number) => (
    <div key={key} onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, padding: '10px 18px', border: `2.5px solid ${INK}`, borderRadius: 999, cursor: 'pointer', ...chipStyle(active) }}>{label}</div>
  );
  const inputStyle: CSSProperties = { width: '100%', fontFamily: SANS, fontSize: 15, fontWeight: 600, padding: '13px 15px', border: `3px solid ${INK}`, borderRadius: 11, outline: 'none', background: '#fff', color: INK };

  if (st.sellStep === 4) {
    return (
      <div className="m-pad" style={{ maxWidth: 1060, margin: '0 auto', padding: '24px 32px 90px' }}>
        <div style={{ maxWidth: 520, margin: '30px auto 0', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <CelebrationIcon sx={{ fontSize: 56, color: '#ff4d3d' }} />
          </div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, letterSpacing: '-.02em', margin: '10px 0 0' }}>Your auction is live!</h1>
          <div style={{ fontSize: 14.5, color: 'rgba(26,19,5,.6)', fontWeight: 500, marginTop: 8 }}>Listed on-chain — the card is locked in escrow until it sells or you cancel.</div>
          {st.lastHash && (
            <a href={td.explorerTx(st.lastHash)} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 700, color: '#2d5bff' }}>View transaction ↗</a>
          )}
          <div style={{ maxWidth: 280, margin: '26px auto 0' }}>
            <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, overflow: 'hidden', boxShadow: `5px 5px 0 ${INK}`, textAlign: 'left' }}>
              <div style={{ position: 'relative', height: 190, background: previewArt }}>
                <div style={{ position: 'absolute', top: 11, left: 11, fontSize: 10, fontWeight: 800, padding: '4px 11px', borderRadius: 7, background: rm.bg, color: rm.color, border: `2px solid ${INK}` }}>{rm.label}</div>
                <div style={{ position: 'absolute', top: 9, right: 9, fontSize: 10, fontWeight: 800, padding: '4px 9px', borderRadius: 7, background: '#13c06a', color: '#fff', border: `2px solid ${INK}` }}>● LIVE</div>
              </div>
              <div style={{ padding: '13px 14px 15px' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{f.title || 'Your card'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 }}>
                  <div><div style={{ fontSize: 10, color: 'rgba(26,19,5,.5)', fontWeight: 600 }}>Starting bid</div><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19 }}>{money(startN)}</div></div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>0 bids</div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28 }}>
            <div onClick={td.goBrowse} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 26px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>View in marketplace</div>
            <div onClick={td.listAnother} style={{ fontWeight: 800, fontSize: 15, padding: '14px 24px', background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer' }}>List another</div>
          </div>
        </div>
      </div>
    );
  }

  // The three sell-flow steps, rendered as a tab bar. A tab unlocks only once the
  // earlier steps validate, so buyers can jump back freely but never skip ahead.
  const TABS: Array<[number, string]> = [[1, 'Details'], [2, 'Pricing'], [3, 'Review']];
  const tabUnlocked = (n: number) =>
    n === 1 || (n === 2 && step1Valid) || (n === 3 && step1Valid && step2Valid);

  const stepTab = (n: number, label: string, last: boolean) => {
    const active = st.sellStep === n;
    const done = st.sellStep > n;
    const unlocked = tabUnlocked(n);
    return (
      <div
        key={n}
        onClick={() => unlocked && td.setSellStep(n)}
        title={unlocked ? undefined : 'Finish the previous step to unlock this one'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 13.5, fontWeight: 800, padding: '11px 22px', cursor: unlocked ? 'pointer' : 'not-allowed', background: active ? INK : '#fff', color: active ? '#fff' : unlocked ? INK : 'rgba(26,19,5,.32)', borderRight: last ? 'none' : `3px solid ${INK}`, transition: 'background .12s' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 21, height: 21, flex: 'none', borderRadius: '50%', fontSize: 11, fontWeight: 800, border: `2px solid ${active ? '#fff' : done ? '#13c06a' : 'currentColor'}`, background: active ? '#ff4d3d' : done ? '#13c06a' : 'transparent', color: active || done ? '#fff' : 'inherit' }}>{done ? '✓' : n}</span>
        {label}
      </div>
    );
  };

  return (
    <div className="m-pad" style={{ maxWidth: 1060, margin: '0 auto', padding: '24px 32px 90px' }}>
      <div onClick={td.goBrowse} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 18, padding: '7px 14px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}` }}>← Cancel</div>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, letterSpacing: '-.02em', margin: 0 }}>List a card for auction</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 6, fontWeight: 500 }}>List a card you hold or mint a brand-new one — in three quick steps.</div>

      <div style={{ display: 'inline-flex', border: `3px solid ${INK}`, borderRadius: 11, overflow: 'hidden', margin: '20px 0 26px', boxShadow: `3px 3px 0 ${INK}` }}>
        {TABS.map(([n, label], i) => stepTab(n, label, i === TABS.length - 1))}
      </div>

      <div className="stack" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 40, alignItems: 'start' }}>
        <div>
          {/* STEP 1 — pick a real card */}
          {st.sellStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.62)', background: '#fff', border: `2px dashed ${INK}`, borderRadius: 11, padding: '13px 15px' }}>
                You&apos;re issuing a brand-new card on-chain. Fill in its details below — it&apos;s minted to your wallet when you publish, then listed for sale.
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>CARD NAME</div>
                <input value={f.title} onChange={(e) => td.setForm('title', e.target.value)} placeholder="e.g. Solar Drake · 1st Edition" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>SET &amp; NUMBER</div>
                <input value={f.setLine} onChange={(e) => td.setForm('setLine', e.target.value)} placeholder="e.g. Base Set · #006 / 102" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>CARD PHOTO</div>
                <div
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); if (!st.dragOver) td.setDragOver(true); }}
                  onDragLeave={() => td.setDragOver(false)}
                  onDrop={td.onDropImage}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: st.dragOver ? '#fff7e6' : '#fff', border: `2.5px dashed ${INK}`, borderRadius: 11, cursor: 'pointer', boxShadow: st.dragOver ? `3px 3px 0 ${INK}` : 'none' }}
                >
                  <div style={{ width: 46, height: 46, flex: 'none', borderRadius: 8, border: `2px solid ${INK}`, background: previewArt }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{f.image ? 'Photo added — click to replace' : 'Upload your own photo'}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>Drag &amp; drop or <span style={{ color: '#2d5bff', textDecoration: 'underline' }}>browse files</span> · PNG/JPG up to 8&nbsp;MB</div>
                  </div>
                  {f.image && (
                    <span onClick={(e) => { e.stopPropagation(); td.setForm('image', undefined); }} style={{ fontSize: 12, fontWeight: 800, color: '#ff4d3d', flex: 'none' }}>Remove</span>
                  )}
                </div>
                <input ref={(el) => { fileInput.current = el; }} type="file" accept="image/*" onChange={td.onPickImage} style={{ display: 'none' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>CATEGORY</div>
                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                  {['Pokémon', 'Sports', 'Other'].map((v) => chip(f.category === v, v, () => td.setForm('category', v), v))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>RARITY</div>
                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                  {(['common', 'rare', 'epic', 'legendary'] as Rarity[]).map((v) => chip(f.rarity === v, v.charAt(0).toUpperCase() + v.slice(1), () => td.setForm('rarity', v), v))}
                </div>
              </div>
              {st.sellMode === 'mint' && (
                <>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>SUPPLY (COPIES TO ISSUE)</div>
                    <input type="number" min={1} max={1000} value={f.supply} onChange={(e) => td.setForm('supply', e.target.value)} style={{ ...inputStyle, width: 140 }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em' }}>CREATOR ROYALTY</span>
                      <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{(Number(f.royaltyPct) || 0).toFixed(1)}%</span>
                    </div>
                    <input type="range" min={0} max={10} step={0.5} value={Number(f.royaltyPct) || 0} onChange={(e) => td.setForm('royaltyPct', e.target.value)} style={{ width: '100%', accentColor: '#ff4d3d' }} />
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 6 }}>You earn this on every resale (max 10%). Paid to your wallet automatically at settlement.</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 2 — pricing */}
          {st.sellStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>CONDITION</div>
                <div style={{ display: 'flex', border: `3px solid ${INK}`, borderRadius: 11, overflow: 'hidden', width: 'fit-content' }}>
                  <div onClick={() => td.setForm('graded', true)} style={{ fontSize: 13, fontWeight: 800, padding: '11px 22px', cursor: 'pointer', background: f.graded ? '#ffd84d' : '#fff', borderRight: `2.5px solid ${INK}` }}>Graded slab</div>
                  <div onClick={() => td.setForm('graded', false)} style={{ fontSize: 13, fontWeight: 800, padding: '11px 22px', cursor: 'pointer', background: !f.graded ? '#ffd84d' : '#fff' }}>Raw card</div>
                </div>
                {f.graded ? (
                  <input value={f.grade} onChange={(e) => td.setForm('grade', e.target.value)} placeholder="e.g. PSA 10, BGS 9.5" style={{ ...inputStyle, marginTop: 12, width: 240 }} />
                ) : (
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 12 }}>
                    {['Mint', 'Near Mint', 'Lightly Played', 'Played'].map((v) => chip(f.condition === v, v, () => td.setForm('condition', v), v))}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>LISTING TYPE</div>
                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                  {chip(f.listingType === 'fixed', 'Fixed price', () => td.setForm('listingType', 'fixed'), 'fixed')}
                  {chip(f.listingType === 'auction', <><TimerIcon sx={{ fontSize: 16 }} /> Auction</>, () => td.setForm('listingType', 'auction'), 'auction')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>{f.listingType === 'auction' ? 'STARTING BID (USDC)' : 'PRICE (USDC)'}</div>
                <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 11, padding: '2px 15px', width: 240 }}>
                  <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>$</span>
                  <input type="number" value={f.startBid} onChange={(e) => td.setForm('startBid', e.target.value)} placeholder="0" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, padding: '11px 6px', width: '100%', color: INK }} />
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 6 }}>{f.listingType === 'auction' ? 'The opening bid — bidders must meet or exceed this.' : 'This is the listing price locked into the settlement contract.'}</div>
              </div>
              {f.listingType === 'auction' ? (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>RESERVE PRICE (USDC) · optional</div>
                  <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 11, padding: '2px 15px', width: 240 }}>
                    <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>$</span>
                    <input type="number" value={f.reserve} onChange={(e) => td.setForm('reserve', e.target.value)} placeholder="0" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, padding: '11px 6px', width: '100%', color: INK }} />
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 6 }}>If the top bid doesn’t reach this, the card returns to you. Leave blank for no reserve.</div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 300 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em' }}>BUY IT NOW</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>Cosmetic preview — fixed-price sale settles at the listed price</div>
                    </div>
                    <div onClick={() => td.setForm('buyNowOn', !f.buyNowOn)} style={{ width: 46, height: 28, borderRadius: 999, border: `2.5px solid ${INK}`, background: f.buyNowOn ? '#13c06a' : '#fff', position: 'relative', cursor: 'pointer', flex: 'none' }}>
                      <div style={{ position: 'absolute', top: 1, left: f.buyNowOn ? 18 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', border: `2px solid ${INK}`, transition: 'left .15s' }} />
                    </div>
                  </div>
                  {f.buyNowOn && (
                    <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 11, padding: '2px 15px', width: 240, marginTop: 12 }}>
                      <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>$</span>
                      <input type="number" value={f.buyNow} onChange={(e) => td.setForm('buyNow', e.target.value)} placeholder="0" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, padding: '11px 6px', width: '100%', color: INK }} />
                    </div>
                  )}
                </div>
              )}
              {f.listingType === 'auction' && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>AUCTION LENGTH</div>
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                    {([[1, '1 day'], [3, '3 days'], [7, '7 days']] as Array<[number, string]>).map(([v, l]) => chip(f.duration === v, l, () => td.setForm('duration', v), v))}
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>DELIVERY</div>
                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                  {chip(f.fulfillment === 'digital', <><BoltIcon sx={{ fontSize: 16 }} /> Digital · instant</>, () => td.setForm('fulfillment', 'digital'), 'digital')}
                  {chip(f.fulfillment === 'physical', <><ShieldIcon sx={{ fontSize: 16 }} /> Physical · escrow</>, () => td.setForm('fulfillment', 'physical'), 'physical')}
                </div>
                <div style={{ fontSize: 11.5, color: 'rgba(26,19,5,.55)', marginTop: 7, maxWidth: 460 }}>
                  {f.fulfillment === 'physical'
                    ? 'Buyer’s funds are held in escrow until they confirm the card arrived. Disputes go to the arbiter.'
                    : 'The card token transfers to the buyer the instant they pay — best for digital-only cards.'}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 — review */}
          {st.sellStep === 3 && (
            <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, padding: '15px 18px', borderBottom: `2.5px solid ${INK}`, background: '#ffd84d' }}>Review your listing</div>
              <div style={{ padding: '6px 18px 12px' }}>
                {(
                  isAuction
                    ? [['Card', f.title || 'Untitled card'], ['Set', f.setLine || '—'], ['Condition', f.graded ? `${f.grade} · Graded` : f.condition], ['Type', 'Auction'], ['Starting bid', money(startN)], ['Reserve', reserveN > 0 ? money(reserveN) : 'None'], ['Runs for', durLabel]]
                    : [['Card', f.title || 'Untitled card'], ['Set', f.setLine || '—'], ['Condition', f.graded ? `${f.grade} · Graded` : f.condition], ['Type', 'Fixed price'], ['Price', money(startN)], ['Buy it now', f.buyNowOn && buyN > 0 ? money(buyN) : 'None'], ['Delivery', f.fulfillment === 'physical' ? 'Physical · escrow' : 'Digital · instant']]
                ) .map(([k, v], i, arr) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderBottom: i === arr.length - 1 ? 'none' : '1.5px solid rgba(26,19,5,.1)' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>{k}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', padding: '12px 18px', background: '#fff7ec', borderTop: `2.5px solid ${INK}` }}>
                <ShieldIcon sx={{ fontSize: 14, flexShrink: 0, marginTop: '2px' }} />
                <span>Your card ships to the TopDeck Vault for authentication before payout. Listing locks one copy in the settlement contract.</span>
              </div>
            </div>
          )}

          {/* nav buttons */}
          <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
            {st.sellStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div onClick={() => step1Valid && td.sellNext()} title={step1Valid ? undefined : st.sellMode === 'mint' ? 'Name your card and add a photo to continue' : 'Pick a card you hold above to continue'} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 28px', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: step1Valid ? 'pointer' : 'not-allowed', background: step1Valid ? '#ff4d3d' : '#e7ddc8', color: step1Valid ? '#fff' : 'rgba(26,19,5,.4)' }}>Continue to pricing →</div>
                {!step1Valid && (
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#ff4d3d' }}>
                    {st.sellMode === 'mint'
                      ? '↑ Give your new card a name and a photo to continue.'
                      : '↑ Pick a card you hold from the grid above to continue — or switch to “Mint a new card”.'}
                  </div>
                )}
              </div>
            )}
            {st.sellStep === 2 && (
              <>
                <div onClick={td.sellBack} style={{ fontWeight: 800, fontSize: 15, padding: '14px 22px', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer', background: '#fff' }}>← Back</div>
                <div onClick={() => step2Valid && td.sellNext()} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 28px', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: step2Valid ? 'pointer' : 'default', background: step2Valid ? '#ff4d3d' : '#e7ddc8', color: step2Valid ? '#fff' : 'rgba(26,19,5,.4)' }}>Review listing →</div>
              </>
            )}
            {st.sellStep === 3 && (
              <>
                <div onClick={td.sellBack} style={{ fontWeight: 800, fontSize: 15, padding: '14px 22px', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer', background: '#fff' }}>← Back</div>
                <div onClick={() => !st.publishing && td.publishListing()} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 30px', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: st.publishing ? 'default' : 'pointer', background: '#13c06a', color: '#fff', opacity: st.publishing ? 0.7 : 1 }}>
                  {st.publishing ? (
                    st.sellMode === 'mint' && !st.mintedCard ? 'Minting…' : 'Publishing…'
                  ) : st.sellMode === 'mint' ? (
                    <>
                      <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                      <span>Mint & publish</span>
                    </>
                  ) : (
                    <>
                      <GavelIcon sx={{ fontSize: 16 }} />
                      <span>Publish auction</span>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* live preview */}
        <div className="m-unstick" style={{ position: 'sticky', top: 90 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 10 }}>LIVE PREVIEW</div>
          <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, overflow: 'hidden', boxShadow: `5px 5px 0 ${INK}` }}>
            <div style={{ position: 'relative', height: 230, background: previewArt }}>
              <div style={{ position: 'absolute', top: 11, left: 11, fontSize: 10, fontWeight: 800, letterSpacing: '.03em', padding: '4px 11px', borderRadius: 7, background: rm.bg, color: rm.color, border: `2px solid ${INK}` }}>{rm.label}</div>
            </div>
            <div style={{ padding: '14px 15px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{f.title || 'Your card name'}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(26,19,5,.5)', marginTop: 3, fontWeight: 600 }}>{f.graded ? `${f.grade} · Graded` : f.condition}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: 'rgba(26,19,5,.5)', fontWeight: 600 }}>Starting bid</div>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>{startN > 0 ? money(startN) : '$0'}</div>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, padding: '4px 9px', borderRadius: 7, background: INK, color: '#fff' }}>
                  <TimerIcon sx={{ fontSize: 13 }} />
                  <span>{durLabel}</span>
                </div>
              </div>
              {f.buyNowOn && buyN > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: '#0a5e34' }}>Buy now · {money(buyN)}</div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 12, textAlign: 'center' }}>This is exactly how buyers will see your card.</div>
        </div>
      </div>
    </div>
  );
}

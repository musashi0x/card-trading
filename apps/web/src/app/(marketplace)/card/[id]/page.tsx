'use client';

import { useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTopDeck, PAY_ASSETS, type PayAssetId } from '@/components/topdeck/TopDeckProvider';
import { type TopCard, money, fmtLeft, fmtAgo, mapBid, rarityMeta, rarityArt, mapRarity, increment } from '@/components/topdeck/lib';
import { useAuctionBids, useToggleWatch, useWatchlist, useCardReviews, useCardReviewEligibility, useSubmitCardReview, useDeleteCardReview, useCardComments, usePostCardComment, useDeleteCardComment } from '@/lib/queries';
import { ReviewForm } from '@/components/topdeck/shared/ReviewForm';
import { ReviewList } from '@/components/topdeck/shared/ReviewList';
import { CommentInput } from '@/components/topdeck/shared/CommentInput';
import { CommentThread } from '@/components/topdeck/shared/CommentThread';
import { INK, DISPLAY, SANS } from '@/components/topdeck/theme';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import BoltIcon from '@mui/icons-material/Bolt';
import CelebrationIcon from '@mui/icons-material/Celebration';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ShareIcon from '@mui/icons-material/Share';
import TimerIcon from '@mui/icons-material/Timer';
import ShieldIcon from '@mui/icons-material/Shield';
import StarIcon from '@mui/icons-material/Star';

function renderPayWith(c: TopCard, st: ReturnType<typeof useTopDeck>['state'], td: ReturnType<typeof useTopDeck>) {
  const price = c.buyNow > 0 ? c.buyNow : c.currentBid;
  const sel = st.payAsset;
  const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

  return (
    <div style={{ marginTop: 18, background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 13, padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 14 }}>Pay with</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {PAY_ASSETS.map((a) => (
            <div
              key={a.id}
              onClick={() => td.selectPayAsset(a.id)}
              style={{
                fontSize: 12.5, fontWeight: 800, padding: '7px 14px', borderRadius: 9, cursor: 'pointer',
                border: `2.5px solid ${INK}`, fontFamily: DISPLAY,
                background: sel === a.id ? INK : '#fff', color: sel === a.id ? '#fff' : INK,
              }}
            >
              {a.label}
            </div>
          ))}
        </div>
      </div>

      {sel !== 'USDC' && (
        <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600 }}>
          {st.quoting && !st.quote ? (
            <div style={{ color: 'rgba(26,19,5,.55)' }}>Fetching best price…</div>
          ) : st.quoteErr ? (
            <div style={{ color: '#a3160a', fontWeight: 700 }}>⚠ {st.quoteErr}</div>
          ) : st.quote && Number(st.quote.destUsdc) <= 0 ? (
            <div style={{ color: '#0a5e34', fontWeight: 700 }}>
              ✓ You already hold enough USDC — no swap needed
            </div>
          ) : st.quote ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div>
                You pay ≈ <strong>{trim(st.quote.sendAmount)} {sel}</strong> → seller receives{' '}
                <strong>{trim(st.quote.destUsdc)} USDC</strong>
              </div>
              <div style={{ color: 'rgba(26,19,5,.55)' }}>
                Max {trim(st.quote.sendMax)} {sel} · {(st.quote.slippageBps / 100).toFixed(2)}% slippage cap
              </div>
            </div>
          ) : (
            <div style={{ color: 'rgba(26,19,5,.55)' }}>
              Converted on-chain to {money(price)} USDC via a Stellar path payment.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderSettlement(c: TopCard) {
  const PLATFORM_BPS = 200; // 2%, matches the contract's fee
  const royaltyBps = c.royaltyBps ?? 0;
  const price = c.buyNow > 0 ? c.buyNow : c.currentBid;
  const fee = (price * PLATFORM_BPS) / 10_000;
  const royalty = (price * royaltyBps) / 10_000;
  const sellerNet = price - fee - royalty;
  const usd = (n: number) => '$' + n.toFixed(2);

  const rows: Array<{ label: string; value: string; color?: string }> = [
    { label: 'Seller receives', value: usd(sellerNet) },
    { label: 'Platform fee · 2%', value: usd(fee) },
  ];
  if (royaltyBps > 0) {
    rows.push({
      label: `Creator royalty · ${(royaltyBps / 100).toFixed(royaltyBps % 100 === 0 ? 0 : 2)}%`,
      value: usd(royalty),
      color: '#7c3aed',
    });
  }

  return (
    <div style={{ marginTop: 18, background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 13, padding: '16px 18px' }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
        Atomic settlement
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginBottom: 12 }}>
        {royaltyBps > 0
          ? 'One transaction splits the sale three ways — the creator is paid on every resale, enforced by the contract.'
          : 'One transaction splits the sale between the seller and the platform fee.'}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: i === 0 ? 'none' : '1.5px solid rgba(26,19,5,.08)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: r.color ?? INK }}>{r.label}</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: r.color ?? INK }}>{r.value}</div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0 0', marginTop: 5, borderTop: `2px solid ${INK}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>Buyer pays</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{usd(price)}</div>
      </div>
    </div>
  );
}

export default function CardDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const td = useTopDeck();
  const st = td.state;
  const { address, connect } = td.wallet;
  const c = id ? td.getCard(id) : undefined;
  const cardId = c?.cardId ?? null;

  const { data: watchEntries } = useWatchlist(address);
  const toggleWatch = useToggleWatch(address);
  const { data: reviewsData } = useCardReviews(cardId ?? '');
  const submitReview = useSubmitCardReview(cardId ?? '', address);
  const deleteReview = useDeleteCardReview(cardId ?? '', address);
  const myReview = reviewsData?.reviews.find((r) => r.authorAddress === address);
  const { data: eligibility } = useCardReviewEligibility(cardId ?? '', address);
  // Show the form to wallets that may review (owned/traded the card) or already have one.
  const canReview = !!myReview || !!eligibility?.eligible;
  const { data: comments = [] } = useCardComments(cardId ?? '');
  const postComment = usePostCardComment(cardId ?? '', address);
  const deleteComment = useDeleteCardComment(cardId ?? '', address);
  // Real bid history for auctions, sourced from the bids API (high bid first).
  const { data: apiBids = [] } = useAuctionBids(c?.isAuction ? (c.auctionId ?? null) : null);
  const watchedSet = useMemo(() => new Set((watchEntries ?? []).map((e) => e.id)), [watchEntries]);

  useEffect(() => {
    if (id) {
      td.viewCard(id);
    }
  }, [id]);

  if (!c) {
    return (
      <div className="m-pad" style={{ maxWidth: 1180, margin: '0 auto', padding: '30px 32px 80px' }}>
        <div style={{ background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16, padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, marginBottom: 16 }}>Listing not found or ended</div>
          <div
            onClick={td.goBrowse}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 800, cursor: 'pointer', padding: '10px 20px', background: INK, color: '#fff', border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: `2px 2px 0 ${INK}`, fontFamily: DISPLAY }}
          >
            Back to auctions
          </div>
        </div>
      </div>
    );
  }

  const rm = rarityMeta(c.rarity);
  const left = c.endsAt - st.now;
  const ending = left < 3600000;
  const min = c.currentBid + increment(c.currentBid);
  const status = st.status[c.id];
  const banner =
    status === 'winning' ? { icon: <EmojiEventsIcon sx={{ fontSize: 18 }} />, t: "You're the top bidder — hold tight!", bg: '#bff3d4', col: '#0a5e34' }
      : status === 'outbid' ? { icon: <BoltIcon sx={{ fontSize: 18 }} />, t: "You've been outbid — raise your bid to win", bg: '#ffd1cc', col: '#a3160a' }
        : status === 'won' ? { icon: <CelebrationIcon sx={{ fontSize: 18 }} />, t: 'Purchased — heading to the TopDeck Vault', bg: '#bff3d4', col: '#0a5e34' }
          : null;
  const watched = !!c.listingId && watchedSet.has(c.listingId);
  const onToggleWatch = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) return connect();
    if (!c.listingId) return;
    toggleWatch.mutate({ listingId: c.listingId, watching: watched });
  };
  // Prefer the live API bid history for auctions; fall back to the card's own
  // (optimistic) bids so a just-placed bid shows immediately.
  const sourceBids =
    c.isAuction && apiBids.length > 0
      ? apiBids.map((b) => mapBid(b, address ?? undefined))
      : c.bids;
  const bids = sourceBids.map((b, i) => ({
    ...b,
    when: b.at ? fmtAgo(st.now - b.at) : '',
    dot: b.outbid ? 'rgba(26,19,5,.25)' : b.you ? '#13c06a' : i === 0 ? '#ff4d3d' : 'rgba(26,19,5,.25)',
    nameColor: b.outbid ? 'rgba(26,19,5,.45)' : b.you ? '#13c06a' : INK,
    rowBg: b.outbid ? '#faf6ee' : b.you ? '#f0fff6' : i === 0 ? '#fff7ec' : '#fff',
    strike: !!b.outbid,
  }));

  return (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 32px 90px' }}>
      <div onClick={td.goBrowse} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 20, padding: '7px 14px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}` }}>← All auctions</div>

      <div className="stack" style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 40, alignItems: 'start' }}>
        <div className="m-unstick" style={{ position: 'sticky', top: 90 }}>
          <div style={{ position: 'relative', aspectRatio: '3 / 4', borderRadius: 18, border: `3px solid ${INK}`, boxShadow: `7px 7px 0 ${INK}`, background: c.art, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 14, left: 14, fontSize: 12, fontWeight: 800, letterSpacing: '.03em', padding: '5px 13px', borderRadius: 8, background: rm.bg, color: rm.color, border: `2px solid ${INK}` }}>{rm.label}</div>
            <div onClick={onToggleWatch} style={{ position: 'absolute', top: 13, right: 13, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: watched ? '#ff4d3d' : '#fff', border: `2.5px solid ${INK}`, color: watched ? '#fff' : 'rgba(26,19,5,.35)', cursor: 'pointer' }}>
              {watched ? <FavoriteIcon sx={{ fontSize: 20 }} /> : <FavoriteBorderIcon sx={{ fontSize: 20 }} />}
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, background: 'linear-gradient(transparent,rgba(26,19,5,.55))', color: '#fff', fontWeight: 700, fontSize: 13 }}>{c.grade}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            {[
              { text: 'Zoom', icon: <ZoomInIcon sx={{ fontSize: 15 }} /> },
              { text: 'Card info', icon: <AssignmentIcon sx={{ fontSize: 15 }} /> },
              { text: 'Share', icon: <ShareIcon sx={{ fontSize: 15 }} /> }
            ].map((item) => (
              <div key={item.text} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: 9, background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9 }}>
                {item.icon}
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(26,19,5,.5)', letterSpacing: '.02em' }}>{c.setLine}</div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, letterSpacing: '-.02em', margin: '6px 0 0', lineHeight: 1.05 }}>{c.name}</h1>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {[c.condition, c.grade, c.cats[0]].map((t, i) => (
              <div key={i} style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, background: '#fff', border: `2px solid ${INK}` }}>{t}</div>
            ))}
          </div>

          {banner && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 700, padding: '11px 15px', borderRadius: 11, border: `2.5px solid ${INK}`, background: banner.bg, color: banner.col }}>
              {banner.icon}
              <span>{banner.t}</span>
            </div>
          )}

          <div style={{ marginTop: 18, background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, padding: '20px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>Current bid · {c.bids.length} bids</div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 42, lineHeight: 1, marginTop: 3 }}>{money(c.currentBid)}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 5 }}>Next bid: {money(min)} or more</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Auction ends in</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, padding: '6px 14px', borderRadius: 10, border: `2.5px solid ${INK}`, marginTop: 5, background: ending ? '#ff4d3d' : INK, color: '#fff' }}>
                  <TimerIcon sx={{ fontSize: 22 }} />
                  <span>{fmtLeft(left)}</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              {c.isAuction && c.auctionStatus === 'open' && left > 0 && (
                <div onClick={td.openBid} style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 800, padding: 15, background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer', fontFamily: DISPLAY }}>Place bid</div>
              )}
              {c.isAuction && c.auctionStatus === 'open' && left <= 0 && (
                <div onClick={st.bidBusy ? undefined : () => td.settleAuction(c.id)} style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 800, padding: 15, background: st.bidBusy ? 'rgba(26,19,5,.35)' : INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: st.bidBusy ? 'default' : 'pointer', fontFamily: DISPLAY }}>{st.bidBusy ? 'Settling…' : 'Settle Auction'}</div>
              )}
              {c.buyNow > 0 && (
                <div onClick={st.paying ? undefined : td.buyNow} style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 800, padding: 15, background: st.paying ? 'rgba(26,19,5,.35)' : '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: st.paying ? 'default' : 'pointer', fontFamily: DISPLAY }}>{st.paying ? 'Completing purchase…' : `Buy now · ${money(c.buyNow)}`}</div>
              )}
            </div>
            {st.payResidual && (
              <div style={{ marginTop: 12, padding: 14, background: '#fff4e6', border: `2.5px solid ${INK}`, borderRadius: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>
                  {st.payResidual.retry ? 'Settlement didn’t complete' : 'This card was just taken'}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.65)', marginTop: 5 }}>
                  Your conversion went through — you’re holding ${st.payResidual.usdc} USDC. {st.payResidual.retry
                    ? 'No need to convert again; you can retry the purchase.'
                    : 'Apply it to another card whenever you like.'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {st.payResidual.retry && (
                    <div onClick={st.paying ? undefined : td.retryBuyNow} style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 800, padding: 11, background: st.paying ? 'rgba(26,19,5,.35)' : '#13c06a', color: '#fff', border: `2.5px solid ${INK}`, borderRadius: 10, cursor: st.paying ? 'default' : 'pointer', fontFamily: DISPLAY }}>{st.paying ? 'Retrying…' : 'Retry purchase'}</div>
                  )}
                  <div onClick={st.payResidual.retry ? td.dismissResidual : td.goBrowse} style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 800, padding: 11, background: '#fff', color: INK, border: `2.5px solid ${INK}`, borderRadius: 10, cursor: 'pointer', fontFamily: DISPLAY }}>{st.payResidual.retry ? 'Dismiss' : 'Browse other cards'}</div>
                </div>
              </div>
            )}
            {c.isAuction && c.auctionStatus === 'open' && c.sellerAddress === address && c.bids.length === 0 && apiBids.length === 0 && (
              <div onClick={st.bidBusy ? undefined : () => td.cancelAuction(c.id)} style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, padding: 12, marginTop: 12, background: '#fff', color: INK, border: `2.5px solid ${INK}`, borderRadius: 11, cursor: st.bidBusy ? 'default' : 'pointer' }}>Cancel auction &amp; reclaim card</div>
            )}
            {c.real && c.contractListingId != null && c.fulfillment === 'physical' && (
              <>
                <div
                  onClick={st.paying ? undefined : td.escrowBuy}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 12, fontSize: 15, fontWeight: 800, padding: 15, background: st.paying ? 'rgba(26,19,5,.35)' : '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: st.paying ? 'default' : 'pointer', fontFamily: DISPLAY }}
                >
                  {st.paying ? 'Locking funds in escrow…' : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <ShieldIcon sx={{ fontSize: 18 }} />
                      <span>Buy with escrow · {money(c.buyNow > 0 ? c.buyNow : c.currentBid)}</span>
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'rgba(26,19,5,.5)', marginTop: 7 }}>
                  {st.payErr ?? 'Funds held on-chain until you confirm the card arrives'}
                </div>
              </>
            )}
            {td.wallet.passkeyAvailable &&
              c.real &&
              c.contractListingId != null &&
              c.fulfillment !== 'physical' && (
                <>
                  <div
                    onClick={st.paying ? undefined : td.payWithPasskey}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 12, fontSize: 15, fontWeight: 800, padding: 15, background: st.paying ? 'rgba(26,19,5,.35)' : INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: st.paying ? 'default' : 'pointer', fontFamily: DISPLAY }}
                  >
                    {st.paying ? 'Confirming…' : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <BoltIcon sx={{ fontSize: 18 }} />
                        <span>Pay with Face ID · {money(c.buyNow > 0 ? c.buyNow : c.currentBid)}</span>
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'rgba(26,19,5,.5)', marginTop: 7 }}>
                    {st.payErr ?? 'No seed phrase · no extension · fees sponsored'}
                  </div>
                </>
              )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.45)', marginTop: 12 }}>
              <ShieldIcon sx={{ fontSize: 14 }} />
              <span>
                {c.fulfillment === 'physical'
                  ? 'Escrow-protected · dispute resolution by the TopDeck arbiter'
                  : 'Buyer protection · authenticated by TopDeck Vault before shipping'}
              </span>
            </div>
          </div>

          {c.buyNow > 0 && renderPayWith(c, st, td)}
          {renderSettlement(c)}

          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 18, padding: '14px 16px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 13 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: c.sellerArt, border: `2.5px solid ${INK}` }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{c.seller}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>
                <StarIcon sx={{ fontSize: 14, color: '#e0a92e' }} />
                <span>{c.sellerRating} · {c.sellerSales} sales</span>
              </div>
            </div>
            {c.sellerAddress && (
              <div onClick={() => td.goStore(c.sellerAddress!)} style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', border: `2.5px solid ${INK}`, borderRadius: 9, cursor: 'pointer' }}>View store</div>
            )}
          </div>

          <div style={{ marginTop: 24 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Bid history</div>
            <div style={{ background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 13, overflow: 'hidden' }}>
              {bids.length === 0 && <div style={{ padding: '16px', fontSize: 13, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>No bids yet — be the first.</div>}
              {bids.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1.5px solid rgba(26,19,5,.1)', background: b.rowBg }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: b.dot }} />
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: b.nameColor }}>{b.bidder}{b.you ? ' · you' : ''}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,19,5,.45)' }}>{b.when}</div>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, minWidth: 80, textAlign: 'right', textDecoration: b.strike ? 'line-through' : 'none', color: b.strike ? 'rgba(26,19,5,.45)' : INK }}>{money(b.amount)}</div>
                </div>
              ))}
            </div>
          </div>

          {cardId && (
            <>
              {/* Reviews */}
              <div style={{ marginTop: 32 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Reviews</div>
                <ReviewList
                  reviews={reviewsData?.reviews ?? []}
                  averageStars={reviewsData?.aggregate.averageStars ?? null}
                  reviewCount={reviewsData?.aggregate.reviewCount ?? 0}
                  myAddress={address}
                  onDelete={(reviewId) => deleteReview.mutate(reviewId)}
                  deleting={deleteReview.isPending}
                  now={st.now}
                />
                {!address ? (
                  <div
                    onClick={connect}
                    style={{ marginTop: 12, padding: '12px 16px', background: '#fff', border: `2px dashed ${INK}`, borderRadius: 10, fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)', cursor: 'pointer', textAlign: 'center' }}
                  >
                    Connect wallet to leave a review
                  </div>
                ) : canReview ? (
                  <ReviewForm
                    onSubmit={(stars, body) =>
                      submitReview.mutate({ authorAddress: address, stars, body: body || null })
                    }
                    submitting={submitReview.isPending}
                    existing={myReview ? { stars: myReview.stars, body: myReview.body } : undefined}
                  />
                ) : (
                  <div
                    style={{ marginTop: 12, padding: '12px 16px', background: '#fff', border: `2px dashed ${INK}`, borderRadius: 10, fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)', textAlign: 'center' }}
                  >
                    Only owners or traders of this card can leave a review
                  </div>
                )}
              </div>

              {/* Comments */}
              <div style={{ marginTop: 32 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Comments</div>
                <CommentThread
                  comments={comments}
                  myAddress={address}
                  onDelete={(commentId) => deleteComment.mutate(commentId)}
                  deleting={deleteComment.isPending}
                  now={st.now}
                />
                <CommentInput
                  connected={!!address}
                  onConnect={connect}
                  onSubmit={(body) => postComment.mutate(body)}
                  submitting={postComment.isPending}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import type { LeaderboardBoard, LeaderboardRow, LeaderboardOwnStanding } from '@cardmkt/shared';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { useLeaderboard } from '@/lib/queries';
import { money, shorten } from '@/components/topdeck/lib';
import { G } from '@/components/topdeck/panels';
import { INK, DISPLAY } from '@/components/topdeck/theme';

const SUBTITLE: Record<LeaderboardBoard, string> = {
  collectors: 'Ranked by total collection value this season.',
  sellers: 'Ranked by 90-day sales volume.',
  traders: 'Ranked by all-time realized profit.',
};

const LABEL: Record<LeaderboardBoard, string> = {
  collectors: 'COLLECTION VALUE',
  sellers: 'SOLD · 90 DAYS',
  traders: 'PROFIT · ALL-TIME',
};

const GRADIENTS = Object.values(G);

/** Deterministic avatar gradient from a wallet address (no usernames on-chain). */
function avatar(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length]!;
}

/** The board's primary metric as a display number. */
function primary(board: LeaderboardBoard, row: LeaderboardRow | LeaderboardOwnStanding): number {
  if (board === 'collectors') return Number(row.collectionValue);
  if (board === 'sellers') return Number(row.salesVolume90d);
  return Number(row.realizedProfit);
}

/** Secondary stats line for the board (cards/win, sales/rating, flips/ROI). */
function subline(
  board: LeaderboardBoard,
  row: LeaderboardRow | LeaderboardOwnStanding,
  ratingAvailable: boolean | null,
): string {
  if (board === 'collectors') {
    const win = row.winRate == null ? '—' : `${row.winRate}%`;
    return `${row.cardsHeld.toLocaleString()} cards · ${win} win rate`;
  }
  if (board === 'sellers') {
    const rating = ratingAvailable === false || row.avgRating == null ? '—' : `★${row.avgRating.toFixed(1)}`;
    return `${row.salesCount.toLocaleString()} sales · ${rating}`;
  }
  return `${row.flipCount.toLocaleString()} flips · ${row.roi ?? '—'} ROI`;
}

export default function LeaderboardPage() {
  const td = useTopDeck();
  const board = td.state.lbTab;
  const account = td.wallet.address;
  const { data, isPending, isError, refetch } = useLeaderboard(board, account);

  const tab = (label: string, key: LeaderboardBoard, last = false) => (
    <div onClick={() => td.setLbTab(key)} style={{ fontSize: 13.5, fontWeight: 800, padding: '11px 22px', cursor: 'pointer', borderRight: last ? 'none' : `3px solid ${INK}`, background: board === key ? INK : '#fff', color: board === key ? '#fff' : INK }}>{label}</div>
  );

  const header = (
    <>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#ff4d3d', letterSpacing: '.04em', marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d3d', animation: 'pulseDot 1.3s infinite' }} />SEASON 4 · ENDS IN 12 DAYS
      </div>
      <h1 className="m-h1" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>Leaderboard</h1>
      <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 8, fontWeight: 500 }}>{SUBTITLE[board]}</div>

      <div style={{ display: 'inline-flex', border: `3px solid ${INK}`, borderRadius: 11, overflow: 'hidden', margin: '22px 0 4px', boxShadow: `3px 3px 0 ${INK}` }}>
        {tab('Top collectors', 'collectors')}
        {tab('Top sellers', 'sellers')}
        {tab('Top traders', 'traders', true)}
      </div>
    </>
  );

  const shell = (children: React.ReactNode) => (
    <div className="m-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
      {header}
      {children}
    </div>
  );

  if (isPending) {
    return shell(
      <div style={{ marginTop: 28, display: 'grid', gap: 12 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ height: 64, borderRadius: 14, border: `3px solid ${INK}`, background: 'rgba(26,19,5,.05)', opacity: 1 - i * 0.08 }} />
        ))}
      </div>,
    );
  }

  if (isError || !data) {
    return shell(
      <div style={{ marginTop: 28, padding: '28px 22px', textAlign: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}` }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>Couldn’t load the leaderboard</div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(26,19,5,.6)', marginTop: 8 }}>The rankings service didn’t respond. Check your connection and try again.</div>
        <div onClick={() => refetch()} style={{ display: 'inline-block', marginTop: 16, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '11px 22px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Retry</div>
      </div>,
    );
  }

  const { rows, ownStanding, ratingAvailable } = data;
  const medals = [{ m: '🥇 1st', bg: '#ffd84d' }, { m: '🥈 2nd', bg: '#dfe5ee' }, { m: '🥉 3rd', bg: '#eab36a' }];
  const hasPodium = rows.length >= 3;
  const podium = hasPodium ? [1, 0, 2].map((idx) => ({ row: rows[idx]!, idx, center: idx === 0 })) : [];
  const rest = hasPodium ? rows.slice(3) : rows;

  return shell(
    <>
      {rows.length === 0 && (
        <div style={{ marginTop: 28, padding: '28px 22px', textAlign: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}` }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>No rankings yet</div>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(26,19,5,.6)', marginTop: 8 }}>Once trades settle this season, the board fills in here.</div>
        </div>
      )}

      {/* podium */}
      {hasPodium && (
        <div className="stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, alignItems: 'end', margin: '28px 0 30px' }}>
          {podium.map(({ row, idx, center }) => {
            const medal = medals[idx]!;
            return (
              <div key={row.stellarAddress} style={{ background: center ? '#fff7ec' : '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, padding: '20px 16px 22px', textAlign: 'center' }}>
                <div style={{ display: 'inline-block', fontFamily: DISPLAY, fontWeight: 800, fontSize: 13, padding: '4px 13px', borderRadius: 8, border: `2.5px solid ${INK}`, background: medal.bg, color: '#1a1305' }}>{medal.m}</div>
                <div style={{ width: center ? 66 : 54, height: center ? 66 : 54, borderRadius: 14, border: `3px solid ${INK}`, background: avatar(row.stellarAddress), margin: '16px auto 0' }} />
                <div style={{ fontWeight: 700, fontSize: 16, marginTop: 12 }}>{shorten(row.stellarAddress)}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(26,19,5,.5)', marginTop: 3 }}>{subline(board, row, ratingAvailable)}</div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: center ? 27 : 22, marginTop: 13, lineHeight: 1 }}>{money(primary(board, row))}</div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.45)', marginTop: 5 }}>{LABEL[board]}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ranked list */}
      {rest.length > 0 && (
        <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden', marginTop: hasPodium ? 0 : 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', background: '#ffd84d', borderBottom: `3px solid ${INK}`, fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.65)' }}>
            <div style={{ width: 28 }}>#</div>
            <div style={{ width: 40 }} />
            <div style={{ flex: 1 }}>MEMBER</div>
            <div style={{ width: 120, textAlign: 'right' }}>{LABEL[board]}</div>
          </div>
          {rest.map((row) => (
            <div key={row.stellarAddress} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: '1.5px solid rgba(26,19,5,.1)', background: (row.rank - 1) % 2 === 0 ? '#fff' : 'rgba(26,19,5,.04)' }}>
              <div style={{ width: 28, fontFamily: DISPLAY, fontWeight: 800, fontSize: 17 }}>{row.rank}</div>
              <div style={{ width: 40, height: 40, borderRadius: 11, border: `2.5px solid ${INK}`, background: avatar(row.stellarAddress), flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{shorten(row.stellarAddress)}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>{subline(board, row, ratingAvailable)}</div>
              </div>
              <div style={{ width: 120, textAlign: 'right', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{money(primary(board, row))}</div>
            </div>
          ))}
        </div>
      )}

      {/* your rank — driven by ownStanding; hidden when no wallet is connected */}
      {!account ? (
        <div style={{ marginTop: 16, padding: '15px 18px', textAlign: 'center', background: INK, color: 'rgba(255,255,255,.85)', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: '4px 4px 0 #ff4d3d', fontSize: 13.5, fontWeight: 700 }}>
          Connect your wallet to see where you rank.
        </div>
      ) : ownStanding ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, padding: '15px 18px', background: INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: '4px 4px 0 #ff4d3d' }}>
          <div style={{ width: 28, fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, color: '#ffd84d' }}>{ownStanding.rank ?? '—'}</div>
          <div style={{ width: 40, height: 40, borderRadius: 11, border: '2.5px solid #fff', background: avatar(account), flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14.5 }}>You</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
              {ownStanding.rank == null ? 'Unranked this season' : subline(board, ownStanding, ratingAvailable)}
            </div>
          </div>
          <div style={{ width: 120, textAlign: 'right', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, color: '#ffd84d' }}>{money(primary(board, ownStanding))}</div>
        </div>
      ) : null}
    </>,
  );
}

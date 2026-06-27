/**
 * Hook test for `useLeaderboard`: verifies it calls `api.leaderboard` with the
 * right params and re-fetches when the board changes. The API client is mocked,
 * so no network is touched.
 */

import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { LeaderboardBoard, LeaderboardResponse } from '@cardmkt/shared';

const leaderboard = vi.fn();
vi.mock('@/lib/api', () => ({ api: { leaderboard: (...args: unknown[]) => leaderboard(...args) } }));

import { useLeaderboard } from './queries';

function response(board: LeaderboardBoard): LeaderboardResponse {
  return { board, rows: [], ownStanding: null, ratingAvailable: null, cachedAt: '2026-01-01T00:00:00Z' };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  leaderboard.mockImplementation((params: { board: LeaderboardBoard }) =>
    Promise.resolve(response(params.board)),
  );
});

afterEach(() => {
  cleanup();
  leaderboard.mockReset();
});

describe('useLeaderboard', () => {
  it('calls api.leaderboard with the board and account', async () => {
    const { result } = renderHook(() => useLeaderboard('collectors', 'GACC'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(leaderboard).toHaveBeenCalledWith({ board: 'collectors', account: 'GACC' });
    expect(result.current.data?.board).toBe('collectors');
  });

  it('omits account (undefined) when no wallet is connected', async () => {
    const { result } = renderHook(() => useLeaderboard('sellers', null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(leaderboard).toHaveBeenCalledWith({ board: 'sellers', account: undefined });
  });

  it('re-fetches with the new board when it changes', async () => {
    const { result, rerender } = renderHook(({ board }) => useLeaderboard(board, 'GACC'), {
      wrapper,
      initialProps: { board: 'collectors' as LeaderboardBoard },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ board: 'traders' });
    await waitFor(() => expect(result.current.data?.board).toBe('traders'));
    expect(leaderboard).toHaveBeenCalledWith({ board: 'traders', account: 'GACC' });
  });
});

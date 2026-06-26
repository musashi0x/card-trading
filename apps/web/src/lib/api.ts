/**
 * Typed client for the marketplace API.
 */

import type {
  BuildTxResponse,
  Card,
  Listing,
  Offer,
  SubmitTxResponse,
  Trade,
  TradeAction,
} from '@cardmkt/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error ?? 'Request failed', body.code ?? 'INTERNAL', body.details);
  }
  return body as T;
}

export const api = {
  cards: () => request<Card[]>('/api/cards'),
  listings: (params?: { q?: string; set?: string; rarity?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<Listing[]>(`/api/listings${qs ? `?${qs}` : ''}`);
  },
  offers: (listingId: string) => request<Offer[]>(`/api/listings/${listingId}/offers`),
  trades: () => request<Trade[]>('/api/trades'),

  build: (action: TradeAction, body: Record<string, unknown>) => {
    const path = action.replace('_', '-');
    return request<BuildTxResponse & { refId: string }>(`/api/tx/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  submit: (signedXdr: string, action: TradeAction, refId: string) =>
    request<SubmitTxResponse>('/api/tx/submit', {
      method: 'POST',
      body: JSON.stringify({ signedXdr, action, refId }),
    }),

  buildTrustline: (account: string, cardId: string) =>
    request<BuildTxResponse & { refId: string }>('/api/tx/trustline', {
      method: 'POST',
      body: JSON.stringify({ account, cardId }),
    }),
  submitClassic: (signedXdr: string) =>
    request<SubmitTxResponse>('/api/tx/submit-classic', {
      method: 'POST',
      body: JSON.stringify({ signedXdr }),
    }),
};

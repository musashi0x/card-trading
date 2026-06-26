/**
 * Typed client for the marketplace API.
 */

import type {
  BuildTxResponse,
  Card,
  Listing,
  Offer,
  PasskeySubmitRequest,
  PathPaymentBuildRequest,
  PathQuoteRequest,
  PathQuoteResponse,
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

  /** Quote a source-asset → USDC conversion (pay-with-any-asset). */
  quotePath: (body: PathQuoteRequest) =>
    request<PathQuoteResponse>('/api/tx/quote-path', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Build the path-payment top-up for an accepted quote. */
  pathPayment: (body: PathPaymentBuildRequest) =>
    request<BuildTxResponse>('/api/tx/path-payment', {
      method: 'POST',
      body: JSON.stringify(body),
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

  /** Relay a passkey smart-wallet deployment (deploy-on-first-use). */
  passkeyDeploy: (signedXdr: string) =>
    request<SubmitTxResponse>('/api/tx/passkey-deploy', {
      method: 'POST',
      body: JSON.stringify({ signedXdr }),
    }),
  /** Relay a passkey-authorized buy_now / make_offer (gasless). */
  passkeySubmit: (body: PasskeySubmitRequest) =>
    request<SubmitTxResponse>('/api/tx/passkey-submit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Dev-only: mint test USDC into a smart wallet so the first purchase has funds. */
  devFundWallet: (wallet: string, amountUsdc?: string) =>
    request<SubmitTxResponse & { amountUsdc: string }>('/api/dev/fund-wallet', {
      method: 'POST',
      body: JSON.stringify({ wallet, amountUsdc }),
    }),
};

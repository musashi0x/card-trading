'use client';

/**
 * Wallet session persistence. The connected wallet normally lives only in React
 * state, so a page reload drops it and the user has to reconnect. We persist a
 * small session record to `localStorage` with a 1-day TTL so a reload can
 * silently rehydrate the connection (re-pointing the wallet kit for classic
 * wallets, or restoring the smart-wallet handle for passkeys). Disconnecting or
 * an expired session clears it.
 *
 * Only the data needed to reconnect is stored — never private keys. Classic
 * wallets keep their own approval/keys in the extension; passkeys keep the
 * credential in the authenticator. The persisted `keyId`/`contractId` are public
 * handles already kept in `localStorage` by passkey-kit.
 */

const STORAGE_KEY = 'topdeck.wallet.session';
/** How long a connection survives across reloads. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

export type WalletSession =
  | { kind: 'classic'; address: string; walletId: string; expiresAt: number }
  | { kind: 'passkey'; address: string; contractId: string; keyId: string; expiresAt: number };

/** Distributive `Omit` so each union member keeps its own discriminant fields. */
type WithoutExpiry<T> = T extends unknown ? Omit<T, 'expiresAt'> : never;

/** Persist a freshly connected wallet, stamping it with a 1-day expiry. */
export function saveSession(session: WithoutExpiry<WalletSession>): void {
  if (typeof localStorage === 'undefined') return;
  const record = { ...session, expiresAt: Date.now() + SESSION_TTL_MS } as WalletSession;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage full or blocked (private mode) — degrade to in-memory only.
  }
}

/** Read the saved session, or `null` when absent, malformed, or expired. */
export function loadSession(): WalletSession | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as WalletSession;
    if (!record || typeof record.expiresAt !== 'number' || record.expiresAt < Date.now()) {
      clearSession();
      return null;
    }
    return record;
  } catch {
    clearSession();
    return null;
  }
}

/** Forget the saved session (on disconnect or when it expires). */
export function clearSession(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

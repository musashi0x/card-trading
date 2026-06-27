/**
 * Global client UI state (Zustand).
 *
 * Use this for cross-cutting UI that doesn't belong to the server cache (which
 * lives in TanStack Query) or to wallet context. Two slices to start:
 *  - `filters`: marketplace search/filter state, pairs with `useListings`.
 *  - `toasts`: a transient notification queue.
 *
 * Read with a selector so a component only re-renders when its slice changes:
 *   const set = useUiStore((s) => s.setFilters);
 *   const q = useUiStore((s) => s.filters.q);
 */

import { create } from 'zustand';

export type ListingFilters = {
  q: string;
  set: string;
  rarity: string;
};

export type Toast = {
  id: number;
  message: string;
  variant: 'info' | 'success' | 'error';
};

type UiState = {
  filters: ListingFilters;
  setFilters: (patch: Partial<ListingFilters>) => void;
  resetFilters: () => void;

  toasts: Toast[];
  /** Push a toast; returns its id so callers can dismiss it early. */
  addToast: (message: string, variant?: Toast['variant']) => number;
  dismissToast: (id: number) => void;
};

const emptyFilters: ListingFilters = { q: '', set: '', rarity: '' };

// Monotonic id source for toasts (kept outside state to avoid re-renders).
let nextToastId = 1;

export const useUiStore = create<UiState>()((set) => ({
  filters: emptyFilters,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: emptyFilters }),

  toasts: [],
  addToast: (message, variant = 'info') => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

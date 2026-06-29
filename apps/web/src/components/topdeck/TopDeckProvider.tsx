'use client';

/**
 * TopDeck state core. `TopDeckProvider` (outer) wires the real marketplace data
 * and wallet context — exactly what the old `TopDeck.tsx` did — and gates on a
 * branded splash while the first listings fetch is in flight. Once data is ready
 * it mounts `TopDeckStore` (inner), which holds the entire UI state and every
 * action behind a `useTopDeck()` hook so each route page stays thin.
 *
 * Screens used to be `this.state.screen`; they are now real routes. `selectedId`
 * is kept but URL-synced by the `/card/[id]` page. Navigation actions push routes
 * via `next/navigation` instead of swapping a state field.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Card,
  FulfillmentMode,
  LeaderboardBoard,
  MintCardRequest,
  PathQuoteResponse,
  StellarAsset,
  TradeAction,
} from '@cardmkt/shared';
import { XLM_ASSET, formatAmount } from '@cardmkt/shared';
import { ApiRequestError, api, type OrderWithCard } from '@/lib/api';
import {
  invalidateOrders,
  queryKeys,
  useAuctions,
  useCards,
  useDisputedOrders,
  useListings,
  useOrders,
} from '@/lib/queries';
import { explorerAccount, explorerTx } from '@/lib/explorer';
import { useWallet, type OrderAction } from '@/components/WalletProvider';
import { DISPLAY, INK } from './theme';
import {
  increment,
  mapAuction,
  mapListing,
  mapRarity,
  rarityArt,
  type Rarity,
  type TopCard,
} from './lib';

// ----- wallet / orders shapes consumed by the store -----

export interface WalletProps {
  address: string | null;
  connecting: boolean;
  walletKind: 'classic' | 'passkey' | null;
  passkeyAvailable: boolean;
  connect: () => void;
  connectViaPasskey: () => Promise<void>;
  disconnect: () => void;
  runAction: (action: TradeAction, body: Record<string, unknown>) => Promise<string>;
  passkeyBuyNow: (listingId: string, contractListingId: number) => Promise<string>;
  passkeyList: (
    cardId: string,
    cardToken: string,
    priceUsdc: string,
    fulfillment?: FulfillmentMode,
  ) => Promise<string>;
  escrowPurchase: (listingId: string, contractListingId: number) => Promise<string>;
  orderAction: (action: OrderAction, orderId: string, contractOrderId: number) => Promise<string>;
  mintCard: (meta: Omit<MintCardRequest, 'owner'>) => Promise<Card>;
  payWithAsset: (quote: PathQuoteResponse) => Promise<string | null>;
}

export interface OrdersProps {
  data: OrderWithCard[];
  disputed: OrderWithCard[];
  loading: boolean;
  error: string | null;
  resolve: (orderId: string, refund: boolean) => Promise<string>;
  refresh: () => void;
}

// ----- sell form + pay assets -----

export interface Form {
  cardId: string;
  title: string;
  setLine: string;
  category: string;
  rarity: Rarity;
  image?: string;
  graded: boolean;
  grade: string;
  condition: string;
  /** Fixed-price listing or a timed auction. */
  listingType: 'fixed' | 'auction';
  startBid: string;
  /** Optional reserve price for an auction; blank/0 = no reserve. */
  reserve: string;
  buyNowOn: boolean;
  buyNow: string;
  duration: number;
  fulfillment: FulfillmentMode;
  supply: string;
  royaltyPct: string;
}

export const EMPTY_FORM: Form = {
  cardId: '', title: '', setLine: '', category: 'Other', rarity: 'rare', image: undefined,
  graded: false, grade: 'PSA 10', condition: 'Near Mint', listingType: 'fixed',
  startBid: '', reserve: '', buyNowOn: false, buyNow: '', duration: 3,
  fulfillment: 'digital', supply: '1', royaltyPct: '0',
};

/** Source assets the buyer can pay with. USDC is the no-conversion default. */
export type PayAssetId = 'USDC' | 'XLM';
export const PAY_ASSETS: Array<{ id: PayAssetId; label: string; asset: StellarAsset | null }> = [
  { id: 'USDC', label: 'USDC', asset: null },
  { id: 'XLM', label: 'XLM', asset: XLM_ASSET },
];

// ----- UI state -----

interface Facets {
  cats: string[];
  rarities: string[];
  graded: boolean;
  buyNow: boolean;
  ending: boolean;
  price: string;
}

export interface TopDeckState {
  selectedId: string | null;
  orderBusy: string | null;
  ordersArbiter: boolean;
  lbTab: LeaderboardBoard;
  query: string;
  sort: string;
  facets: Facets;
  bidOpen: boolean;
  bidAmount: string;
  /** A bid/settle/cancel transaction is in flight. */
  bidBusy: boolean;
  toast: string | null;
  toastKind: 'win' | 'outbid';
  status: Record<string, string>;
  myMax: Record<string, number>;
  sellStep: number;
  sellMode: 'hold' | 'mint';
  mintedCard: Card | null;
  myBidsTab: 'bidding' | 'selling';
  publishing: boolean;
  lastHash: string | null;
  dragOver: boolean;
  form: Form;
  cards: TopCard[];
  /** A manual browse-grid refresh is in flight. */
  refreshing: boolean;
  now: number;
  page: number;
  payAsset: PayAssetId;
  quote: PathQuoteResponse | null;
  quoting: boolean;
  quoteErr: string | null;
  paying: boolean;
  payErr: string | null;
  /**
   * Set when a pay-with-any-asset conversion confirmed but the `buy_now`
   * settlement did not. The buyer holds `usdc` already; `retry` is true when the
   * failure was transient (same listing still buyable) and false when terminal
   * (listing gone — apply the USDC elsewhere). `cardId`/`listingId` anchor a retry.
   */
  payResidual: { usdc: string; cardId: string; listingId: string; retry: boolean } | null;
  walletMenuOpen: boolean;
  navMenuOpen: boolean;
  filtersOpen: boolean;
  addressCopied: boolean;
  guideOpen: boolean;
}

function makeInitialState(seed: TopCard[]): TopDeckState {
  return {
    selectedId: null, lbTab: 'collectors',
    query: '', sort: 'ending', now: Date.now(), page: 1,
    facets: { cats: [], rarities: [], graded: false, buyNow: false, ending: false, price: 'any' },
    bidOpen: false, bidAmount: '', bidBusy: false, toast: null, toastKind: 'win',
    status: {}, myMax: {},
    sellStep: 1, sellMode: 'hold', mintedCard: null, myBidsTab: 'bidding', publishing: false, lastHash: null, dragOver: false,
    form: { ...EMPTY_FORM },
    cards: seed,
    refreshing: false,
    payAsset: 'USDC', quote: null, quoting: false, quoteErr: null,
    paying: false, payErr: null, payResidual: null,
    orderBusy: null, ordersArbiter: false,
    walletMenuOpen: false, navMenuOpen: false, filtersOpen: false, addressCopied: false,
    guideOpen: false,
  };
}

type Patch = Partial<TopDeckState> | ((s: TopDeckState) => Partial<TopDeckState>);

// ----- context shape -----

export interface TopDeckContext {
  state: TopDeckState;
  wallet: WalletProps;
  orders: OrdersProps;
  catalog: Card[];
  explorerTx: (hash: string) => string;
  explorerAddress: (address: string) => string;
  getCard: (id: string | null) => TopCard | undefined;

  // navigation
  open: (id: string) => void;
  goHome: () => void;
  goBrowse: () => void;
  goMyBids: () => void;
  goSell: () => void;
  goLeaderboard: () => void;
  goPortfolio: () => void;
  goFaucet: () => void;
  goTrade: () => void;
  goTrades: () => void;
  goProfile: () => void;
  /** Open a seller's public store/profile page. */
  goStore: (address: string) => void;
  openOrders: () => void;
  openGuide: () => void;
  closeGuide: () => void;
  /** URL-sync the detail screen to a card id (called by /card/[id] on mount). */
  viewCard: (id: string) => void;

  // browse: refresh / filters / sort / search / pagination
  /** Re-fetch open listings + auctions and reseed the browse grid. */
  refresh: () => Promise<void>;
  setPage: (p: number) => void;
  toggleCat: (v: string) => void;
  toggleRarity: (v: string) => void;
  toggleFlag: (k: 'graded' | 'buyNow' | 'ending') => void;
  setPrice: (v: string) => void;
  setSort: (v: string) => void;
  clearFilters: () => void;
  setQuery: (e: ChangeEvent<HTMLInputElement>) => void;
  clearQuery: () => void;
  toggleFilters: () => void;
  closeFilters: () => void;

  // my bids
  setMyBidsTab: (t: 'bidding' | 'selling') => void;

  // bidding (real on-chain auctions)
  openBid: () => void;
  openBidFor: (id: string) => void;
  closeBid: () => void;
  onBidInput: (e: ChangeEvent<HTMLInputElement>) => void;
  setBid: (v: number) => void;
  placeBid: () => Promise<void>;
  settleAuction: (id?: string) => Promise<void>;
  cancelAuction: (id?: string) => Promise<void>;

  // pay-with-any-asset + checkout
  selectPayAsset: (id: PayAssetId) => void;
  buyNow: () => Promise<void>;
  payWithPasskey: () => Promise<void>;
  escrowBuy: () => Promise<void>;
  /** Retry the settlement after a transient post-conversion failure (no re-convert). */
  retryBuyNow: () => Promise<void>;
  /** Dismiss the residual-USDC notice after a post-conversion failure. */
  dismissResidual: () => void;

  // orders
  doOrderAction: (action: OrderAction, o: OrderWithCard) => Promise<void>;
  resolveDispute: (o: OrderWithCard, refund: boolean) => Promise<void>;
  setOrdersArbiter: (v: boolean) => void;

  // sell flow
  setSellMode: (mode: 'hold' | 'mint') => void;
  setForm: (k: keyof Form, v: unknown) => void;
  readImageFile: (file: File | undefined) => void;
  onPickImage: (e: ChangeEvent<HTMLInputElement>) => void;
  onDropImage: (e: DragEvent<HTMLDivElement>) => void;
  setDragOver: (v: boolean) => void;
  selectCatalogCard: (c: Card) => void;
  sellNext: () => void;
  sellBack: () => void;
  listAnother: () => void;
  publishListing: () => Promise<void>;

  // leaderboard
  setLbTab: (t: LeaderboardBoard) => void;

  // wallet menu
  onWalletClick: () => void;
  closeWalletMenu: () => void;
  toggleNavMenu: () => void;
  closeNavMenu: () => void;
  disconnectWallet: () => void;
  copyAddress: () => Promise<void>;

  // toast
  showToast: (text: string, kind?: 'win' | 'outbid') => void;
}

const Ctx = createContext<TopDeckContext | null>(null);

export function useTopDeck(): TopDeckContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTopDeck must be used within TopDeckProvider');
  return v;
}

// ===========================================================================
// Inner store: holds all UI state + actions.
// ===========================================================================

interface StoreProps {
  wallet: WalletProps;
  orders: OrdersProps;
  seedCards: TopCard[];
  /** Re-fetch the live listings + auctions and map them to fresh browse cards. */
  fetchFreshCards: () => Promise<TopCard[]>;
  catalog: Card[];
  children: ReactNode;
}

function TopDeckStore({ wallet, orders, seedCards, fetchFreshCards, catalog, children }: StoreProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [state, setStateRaw] = useState<TopDeckState>(() => makeInitialState(seedCards));
  // A live mirror so async callbacks (timers, quote responses) read fresh state
  // without re-subscribing — mirrors `this.state` in the old class component.
  const ref = useRef(state);
  const setState = useCallback((patch: Patch) => {
    setStateRaw((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : patch;
      const merged = { ...prev, ...next };
      ref.current = merged;
      return merged;
    });
  }, []);

  // timers
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyT = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1s clock — paused during a bid modal or on the sell screen (matches original).
  useEffect(() => {
    const tick = setInterval(() => {
      if (!ref.current.bidOpen && pathname !== '/sell') setState({ now: Date.now() });
    }, 1000);
    return () => clearInterval(tick);
  }, [pathname, setState]);

  // onboarding guide auto-open for new users
  useEffect(() => {
    const seen = localStorage.getItem('topdeck_guide_seen');
    if (!seen) {
      setState({ guideOpen: true });
    }
  }, [setState]);

  useEffect(
    () => () => {
      if (toastT.current) clearTimeout(toastT.current);
      if (copyT.current) clearTimeout(copyT.current);
    },
    [],
  );

  const getCard = useCallback((id: string | null) => ref.current.cards.find((c) => c.id === id), []);

  // ----- toast -----
  const showToast = useCallback(
    (text: string, kind: 'win' | 'outbid' = 'win') => {
      if (toastT.current) clearTimeout(toastT.current);
      setState({ toast: text, toastKind: kind });
      toastT.current = setTimeout(() => setState({ toast: null }), 3400);
    },
    [setState],
  );

  // ----- browse grid refresh -----
  // The grid snapshots its cards at mount (plus optimistic edits), so a manual
  // refresh re-fetches the live listings/auctions and reseeds the grid with the
  // authoritative server state.
  const refresh = useCallback(async () => {
    if (ref.current.refreshing) return;
    setState({ refreshing: true });
    try {
      const fresh = await fetchFreshCards();
      setState({ cards: fresh, page: 1, refreshing: false });
    } catch {
      setState({ refreshing: false });
      showToast('Could not refresh — try again', 'outbid');
    }
  }, [fetchFreshCards, setState, showToast]);

  // ----- navigation -----
  const open = (id: string) => {
    setState({ selectedId: id, payAsset: 'USDC', quote: null, quoteErr: null });
    router.push(`/card/${id}`);
  };
  const goHome = () => router.push('/');
  const goBrowse = () => router.push('/browse');
  const goMyBids = () => router.push('/my-bids');
  const goSell = () => {
    setState({ sellStep: 1, mintedCard: null });
    router.push('/sell');
  };
  const goLeaderboard = () => router.push('/leaderboard');
  const goPortfolio = () => router.push('/portfolio');
  const goFaucet = () => {
    setState({ walletMenuOpen: false });
    router.push('/faucet');
  };
  const goTrade = () => router.push('/trade');
  const goTrades = () => router.push('/trades');
  const goProfile = () => router.push('/profile');
  const goStore = (address: string) => router.push(`/profile/${encodeURIComponent(address)}`);
  const openOrders = () => {
    setState({ navMenuOpen: false });
    router.push('/orders');
  };
  const openGuide = () => setState({ guideOpen: true });
  const closeGuide = () => {
    localStorage.setItem('topdeck_guide_seen', 'true');
    setState({ guideOpen: false });
  };
  const viewCard = (id: string) =>
    setState({ selectedId: id, payAsset: 'USDC', quote: null, quoteErr: null, paying: false, payErr: null });

  const setSellMode = (mode: 'hold' | 'mint') =>
    setState((s) => ({ sellMode: mode, mintedCard: null, form: { ...s.form, cardId: '' } }));
  const setMyBidsTab = (t: 'bidding' | 'selling') => setState({ myBidsTab: t });
  const setLbTab = (t: LeaderboardBoard) => setState({ lbTab: t });

  // The barter trade builder and inbox are self-contained on the /trade route
  // (see trade/page.tsx + TradeInbox), backed by the real `/api/trade-proposals`
  // endpoints — they no longer route through this provider's state.

  // ----- pagination -----
  const setPage = (p: number) => {
    setState({ page: p });
    window.scrollTo(0, 0);
  };

  // ----- filters -----
  const toggleCat = (v: string) =>
    setState((s) => ({ page: 1, facets: { ...s.facets, cats: s.facets.cats.includes(v) ? s.facets.cats.filter((x) => x !== v) : [...s.facets.cats, v] } }));
  const toggleRarity = (v: string) =>
    setState((s) => ({ page: 1, facets: { ...s.facets, rarities: s.facets.rarities.includes(v) ? s.facets.rarities.filter((x) => x !== v) : [...s.facets.rarities, v] } }));
  const toggleFlag = (k: 'graded' | 'buyNow' | 'ending') =>
    setState((s) => ({ page: 1, facets: { ...s.facets, [k]: !s.facets[k] } }));
  const setPrice = (v: string) => setState((s) => ({ page: 1, facets: { ...s.facets, price: v } }));
  const setSort = (v: string) => setState({ page: 1, sort: v });
  const clearFilters = () =>
    setState({ page: 1, query: '', sort: 'ending', facets: { cats: [], rarities: [], graded: false, buyNow: false, ending: false, price: 'any' } });

  // ----- search -----
  const setQuery = (e: ChangeEvent<HTMLInputElement>) => {
    setState({ page: 1, query: e.target.value });
    // Typing in search from another screen jumps back to the browse grid.
    if (pathname.startsWith('/card/') || pathname === '/sell' || pathname === '/') {
      router.push('/browse');
    }
  };
  const clearQuery = () => setState({ page: 1, query: '' });

  // ----- bidding (simulated) -----
  const openBid = () => {
    const c = getCard(ref.current.selectedId);
    if (!c) return;
    const min = c.currentBid + increment(c.currentBid);
    setState({ bidOpen: true, bidAmount: String(min) });
  };
  const openBidFor = (id: string) => {
    const c = getCard(id);
    if (!c) return;
    const min = c.currentBid + increment(c.currentBid);
    setState({ selectedId: id, bidOpen: true, bidAmount: String(min) });
  };
  const closeBid = () => setState({ bidOpen: false });
  const onBidInput = (e: ChangeEvent<HTMLInputElement>) => setState({ bidAmount: e.target.value });
  const setBid = (v: number) => setState({ bidAmount: String(v) });

  /**
   * Place a real on-chain bid: build → sign → submit `place_bid`. The amount must
   * exceed the current high bid (validated here before signing). On success the
   * card is optimistically promoted to the new high bid; the 5s auction poll then
   * reconciles the authoritative state (and any anti-snipe extension).
   */
  const placeBid = async () => {
    const c = getCard(ref.current.selectedId);
    if (!c || !c.isAuction || !c.auctionId) return;
    const amt = Number(ref.current.bidAmount);
    if (!amt || amt <= c.currentBid) {
      showToast('Enter a bid above the current high bid', 'outbid');
      return;
    }
    const { address, connect, runAction } = wallet;
    if (!address) {
      showToast('Connect your wallet to bid', 'outbid');
      connect();
      return;
    }
    if (c.sellerAddress === address) {
      showToast('You cannot bid on your own auction', 'outbid');
      return;
    }
    if (ref.current.now >= c.endsAt) {
      showToast('This auction has ended', 'outbid');
      return;
    }
    setState({ bidBusy: true });
    try {
      const hash = await runAction('place_bid', {
        auctionId: c.auctionId,
        bidder: address,
        amountUsdc: formatAmount(amt),
      });
      setState((s) => ({
        cards: s.cards.map((x) =>
          x.id === c.id
            ? {
                ...x,
                currentBid: amt,
                highBidder: address,
                bids: [
                  { bidder: 'You', amount: amt, at: Date.now(), you: true },
                  ...x.bids.map((b) => ({ ...b, outbid: true })),
                ],
              }
            : x,
        ),
        status: { ...s.status, [c.id]: 'winning' },
        myMax: { ...s.myMax, [c.id]: amt },
        bidOpen: false,
        bidBusy: false,
        lastHash: hash,
      }));
      showToast("You're the highest bidder!", 'win');
    } catch (err) {
      setState({ bidBusy: false });
      showToast(err instanceof ApiRequestError ? err.message : 'Bid failed — try again', 'outbid');
    }
  };

  /** Settle an expired auction (permissionless): build → sign → submit `settle_auction`. */
  const settleAuction = async (id?: string) => {
    const c = getCard(id ?? ref.current.selectedId);
    if (!c?.isAuction || !c.auctionId) return;
    const { address, connect, runAction } = wallet;
    if (!address) {
      showToast('Connect your wallet to settle', 'outbid');
      connect();
      return;
    }
    if (ref.current.now < c.endsAt) {
      showToast('Auction is still live — settle once it ends', 'outbid');
      return;
    }
    setState({ bidBusy: true });
    try {
      const hash = await runAction('settle_auction', { auctionId: c.auctionId, account: address });
      setState((s) => ({ bidBusy: false, lastHash: hash }));
      showToast('Auction settled ✓', 'win');
    } catch (err) {
      setState({ bidBusy: false });
      showToast(err instanceof ApiRequestError ? err.message : 'Settle failed', 'outbid');
    }
  };

  /** Cancel a no-bid auction the connected wallet owns: `cancel_auction`. */
  const cancelAuction = async (id?: string) => {
    const c = getCard(id ?? ref.current.selectedId);
    if (!c?.isAuction || !c.auctionId) return;
    const { address, connect, runAction } = wallet;
    if (!address) {
      showToast('Connect your wallet to cancel', 'outbid');
      connect();
      return;
    }
    if (c.highBidder) {
      showToast("Auctions with bids can't be cancelled", 'outbid');
      return;
    }
    setState({ bidBusy: true });
    try {
      const hash = await runAction('cancel_auction', { auctionId: c.auctionId, seller: address });
      setState((s) => ({
        cards: s.cards.filter((x) => x.id !== c.id),
        bidBusy: false,
        lastHash: hash,
      }));
      showToast('Auction cancelled — card returned', 'win');
    } catch (err) {
      setState({ bidBusy: false });
      showToast(err instanceof ApiRequestError ? err.message : 'Cancel failed', 'outbid');
    }
  };

  // ----- pay-with-any-asset -----
  const quoteError = (err: unknown): string => {
    if (err instanceof ApiRequestError) {
      if (err.code === 'NO_PATH') return 'No swap route for this asset right now';
      if (err.code === 'INSUFFICIENT_BALANCE') return 'Not enough of this asset to cover the price';
      if (err.code === 'ACCOUNT_NOT_FOUND') return 'Fund your wallet to pay with this asset';
      return err.message;
    }
    return 'Could not fetch a quote';
  };

  const selectPayAsset = (id: PayAssetId) => {
    setState({ payAsset: id, quote: null, quoteErr: null });
    const def = PAY_ASSETS.find((a) => a.id === id);
    if (!def?.asset) return; // USDC — no conversion needed
    const c = getCard(ref.current.selectedId);
    const { address } = wallet;
    if (!c || !address) {
      if (!address) setState({ quoteErr: 'Connect your wallet to see a quote' });
      return;
    }
    const price = c.buyNow > 0 ? c.buyNow : c.currentBid;
    setState({ quoting: true });
    api
      .quotePath({ buyer: address, sourceAsset: def.asset, destUsdc: formatAmount(price) })
      .then((quote) => {
        if (ref.current.selectedId === c.id && ref.current.payAsset === id) {
          setState({ quote, quoting: false });
        }
      })
      .catch((err) => {
        if (ref.current.selectedId === c.id && ref.current.payAsset === id) {
          setState({ quoting: false, quoteErr: quoteError(err) });
        }
      });
  };

  /** Message for a failed buy/settlement attempt. */
  const buyError = (err: unknown) =>
    err instanceof ApiRequestError ? err.message : 'Purchase failed — try again';

  /**
   * A settlement failure is terminal for THIS listing (no point retrying) when
   * the listing is closed or the contract rejected it as un-buyable; anything
   * else (network, RPC) is transient and safe to retry without re-converting.
   */
  const isTerminalBuyError = (err: unknown) =>
    err instanceof ApiRequestError &&
    (err.code === 'LISTING_CLOSED' || /NotOpen|SelfTrade|WrongFulfillment/i.test(err.message));

  /** Build → sign → submit a real `buy_now` settlement for a card. */
  const settleBuyNow = (listingId: string, buyer: string) =>
    wallet.runAction('buy_now', { listingId, buyer });

  const buyNow = async () => {
    const c = getCard(ref.current.selectedId);
    if (!c) return;
    const { address, connect, payWithAsset } = wallet;

    if (!address) {
      showToast('Connect your wallet to pay', 'outbid');
      connect();
      return;
    }
    // Only a real, contract-backed digital listing can settle on-chain.
    if (!c.real || c.contractListingId == null || !c.listingId) {
      showToast('This listing is not available to buy', 'outbid');
      return;
    }
    const listingId = c.listingId;
    const def = PAY_ASSETS.find((a) => a.id === ref.current.payAsset);
    setState({ paying: true, payErr: null, payResidual: null });

    // USDC: settle directly, no conversion.
    if (!def?.asset) {
      try {
        const hash = await settleBuyNow(listingId, address);
        setState((s) => ({ status: { ...s.status, [c.id]: 'won' }, paying: false, lastHash: hash }));
        showToast(`Purchased! ${c.name} is yours 🎉`, 'win');
      } catch (err) {
        const msg = buyError(err);
        setState({ paying: false, payErr: msg });
        showToast(msg, 'outbid');
      }
      return;
    }

    // Non-USDC: recheck open → convert (irreversible) → settle.
    const quote = ref.current.quote;
    if (!quote) {
      setState({ paying: false });
      showToast('Fetching a quote — try again in a moment', 'outbid');
      return;
    }
    try {
      const fresh = await api.listing(listingId);
      if (fresh.status !== 'open') {
        setState({ paying: false, payErr: 'This card is no longer available' });
        showToast('This card was just bought by someone else', 'outbid');
        return;
      }
    } catch {
      setState({ paying: false, payErr: 'Could not verify the listing — try again' });
      showToast('Could not verify the listing — try again', 'outbid');
      return;
    }

    // The conversion is irreversible once it confirms; a failure here spends nothing.
    try {
      await payWithAsset(quote);
    } catch (err) {
      const msg = buyError(err);
      setState({ paying: false, payErr: msg });
      showToast(msg, 'outbid');
      return;
    }

    // Settlement leg — failures here are AFTER the buyer has already paid in USDC.
    try {
      const hash = await settleBuyNow(listingId, address);
      setState((s) => ({ status: { ...s.status, [c.id]: 'won' }, paying: false, lastHash: hash }));
      showToast(`Paid with ${def.label} — ${c.name} is yours 🎉`, 'win');
    } catch (err) {
      const retry = !isTerminalBuyError(err);
      setState({
        paying: false,
        payErr: buyError(err),
        payResidual: { usdc: quote.destUsdc, cardId: c.id, listingId, retry },
      });
      showToast(
        retry
          ? 'Settlement failed — your USDC is safe, you can retry'
          : 'That card was taken — your converted USDC is in your wallet',
        'outbid',
      );
    }
  };

  /** Retry settlement after a transient post-conversion failure — no re-convert. */
  const retryBuyNow = async () => {
    const res = ref.current.payResidual;
    const { address } = wallet;
    if (!res || !address) return;
    setState({ paying: true, payErr: null });
    try {
      const hash = await settleBuyNow(res.listingId, address);
      setState((s) => ({
        status: { ...s.status, [res.cardId]: 'won' },
        paying: false,
        payResidual: null,
        lastHash: hash,
      }));
      showToast('Settled — the card is yours 🎉', 'win');
    } catch (err) {
      const retry = !isTerminalBuyError(err);
      setState((s) => ({
        paying: false,
        payErr: buyError(err),
        payResidual: s.payResidual ? { ...s.payResidual, retry } : null,
      }));
      showToast(
        retry
          ? 'Still failing — your USDC is safe, try again shortly'
          : 'That card was taken — your USDC remains in your wallet',
        'outbid',
      );
    }
  };

  const dismissResidual = () => setState({ payResidual: null, payErr: null });

  const payWithPasskey = async () => {
    const c = getCard(ref.current.selectedId);
    if (!c?.real || c.contractListingId == null || !c.listingId) return;
    const { passkeyBuyNow, walletKind, connectViaPasskey } = wallet;
    setState({ paying: true, payErr: null });
    try {
      if (walletKind !== 'passkey') await connectViaPasskey();
      const hash = await passkeyBuyNow(c.listingId, c.contractListingId);
      setState((s) => ({ status: { ...s.status, [c.id]: 'won' }, paying: false, lastHash: hash }));
      showToast(`Face ID confirmed — ${c.name} is yours 🎉`, 'win');
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : 'Purchase cancelled — try again';
      setState({ paying: false, payErr: msg });
      showToast(msg, 'outbid');
    }
  };

  const escrowBuy = async () => {
    const c = getCard(ref.current.selectedId);
    if (!c?.real || c.contractListingId == null || !c.listingId) return;
    const { escrowPurchase, address, walletKind, connect, connectViaPasskey } = wallet;
    if (!address) {
      if (walletKind == null && wallet.passkeyAvailable) {
        await connectViaPasskey();
      } else {
        showToast('Connect your wallet to buy', 'outbid');
        connect();
        return;
      }
    }
    setState({ paying: true, payErr: null });
    try {
      const hash = await escrowPurchase(c.listingId, c.contractListingId);
      setState((s) => ({ status: { ...s.status, [c.id]: 'won' }, paying: false, lastHash: hash }));
      showToast(`Funds held in escrow — ${c.name} ships next 🛡`, 'win');
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : (err as Error).message;
      setState({ paying: false, payErr: msg });
      showToast(msg, 'outbid');
    }
  };

  // ----- orders -----
  const doOrderAction = async (action: OrderAction, o: OrderWithCard) => {
    if (o.contractOrderId == null) {
      showToast('Order is not yet confirmed on-chain', 'outbid');
      return;
    }
    setState({ orderBusy: o.id });
    try {
      const hash = await wallet.orderAction(action, o.id, o.contractOrderId);
      setState({ orderBusy: null, lastHash: hash });
      showToast('Done ✓', 'win');
    } catch (err) {
      setState({ orderBusy: null });
      showToast(err instanceof ApiRequestError ? err.message : (err as Error).message, 'outbid');
    }
  };

  const resolveDispute = async (o: OrderWithCard, refund: boolean) => {
    setState({ orderBusy: o.id });
    try {
      const hash = await orders.resolve(o.id, refund);
      setState({ orderBusy: null, lastHash: hash });
      showToast(refund ? 'Refunded the buyer' : 'Released to the seller', 'win');
    } catch (err) {
      setState({ orderBusy: null });
      showToast(err instanceof ApiRequestError ? err.message : (err as Error).message, 'outbid');
    }
  };

  const setOrdersArbiter = (v: boolean) => setState({ ordersArbiter: v });

  // ----- sell flow -----
  const setForm = (k: keyof Form, v: unknown) => setState((s) => ({ form: { ...s.form, [k]: v } }));
  const setDragOver = (v: boolean) => setState({ dragOver: v });

  const compressImage = (dataUrl: string): Promise<string> => {
    const MAX_EDGE = 1280;
    const QUALITY = 0.85;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no 2d context'));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      };
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    });
  };

  const readImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast('Please choose an image file', 'outbid');
    if (file.size > 8 * 1024 * 1024) return showToast('Image must be under 8 MB', 'outbid');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setForm('image', await compressImage(String(reader.result)));
      } catch {
        showToast('Could not process that image — try another', 'outbid');
      }
    };
    reader.onerror = () => showToast('Could not read that file — try another', 'outbid');
    reader.readAsDataURL(file);
  };

  const onPickImage = (e: ChangeEvent<HTMLInputElement>) => {
    readImageFile(e.target.files?.[0]);
    e.target.value = '';
  };
  const onDropImage = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setState({ dragOver: false });
    readImageFile(e.dataTransfer.files?.[0]);
  };

  const selectCatalogCard = (c: Card) =>
    setState((s) => ({
      form: { ...s.form, cardId: c.id, title: c.name, setLine: c.set, rarity: mapRarity(c.rarity), image: c.imageUrl, category: 'Other' },
    }));
  const sellNext = () => {
    setState((s) => ({ sellStep: Math.min(3, s.sellStep + 1) }));
    window.scrollTo(0, 0);
  };
  const sellBack = () => {
    setState((s) => ({ sellStep: Math.max(1, s.sellStep - 1) }));
    window.scrollTo(0, 0);
  };
  const listAnother = () => {
    setState({ sellStep: 1, form: { ...EMPTY_FORM }, lastHash: null, mintedCard: null });
    window.scrollTo(0, 0);
  };

  const formToCard = (f: Form, hash: string): TopCard => {
    const isAuction = f.listingType === 'auction';
    const start = Number(f.startBid) || 0;
    const buy = !isAuction && f.buyNowOn ? Number(f.buyNow) || 0 : 0;
    const image = f.image;
    return {
      id: 'self-' + hash.slice(0, 12), cardId: f.cardId, real: true, mine: true,
      isAuction, auctionStatus: isAuction ? 'open' : undefined,
      sellerAddress: wallet.address ?? undefined,
      name: f.title || 'Untitled card', rarity: f.rarity,
      condition: f.graded ? f.grade + ' · Graded' : f.condition, grade: f.graded ? f.grade : 'Raw',
      cats: [f.category], art: image ? `center/cover no-repeat url("${image}")` : rarityArt(f.rarity),
      image, sellerArt: 'linear-gradient(135deg,#ff4d3d,#ffb83d)',
      currentBid: start, endsAt: isAuction ? Date.now() + f.duration * 86400000 : 0, buyNow: buy,
      seller: 'You', sellerRating: 'New', sellerSales: '0',
      setLine: (f.setLine || 'YOUR LISTING').toUpperCase(), bids: [],
    };
  };

  const publishListing = async () => {
    const f = ref.current.form;
    const isMint = ref.current.sellMode === 'mint';
    const isAuction = f.listingType === 'auction';
    const start = Number(f.startBid) || 0;
    const reserve = Number(f.reserve) || 0;
    if (isMint) {
      if (!f.title.trim()) return showToast('Name your new card', 'outbid');
      if (!f.image) return showToast('Add a photo for your new card', 'outbid');
    } else if (!f.cardId) {
      return showToast('Pick a card to list', 'outbid');
    }
    if (!(start > 0)) return showToast('Enter a starting bid', 'outbid');
    if (isAuction) {
      if (!(f.duration > 0)) return showToast('Choose an auction duration', 'outbid');
      if (reserve > 0 && reserve < start) {
        return showToast('Reserve must be at least the start price', 'outbid');
      }
    }
    const { address, walletKind, connect, runAction, passkeyList, mintCard } = wallet;
    if (!address) {
      showToast('Connect your wallet to list', 'outbid');
      connect();
      return;
    }
    if (isAuction && walletKind === 'passkey') {
      return showToast('Auctions require a standard Stellar wallet', 'outbid');
    }
    setState({ publishing: true });
    try {
      let cardId = f.cardId;
      let sacAddress = ref.current.mintedCard?.sacAddress ?? null;

      // Pre-flight: confirm the seller actually holds this card on-chain before
      // asking the contract to escrow it. Listing escrows ONE copy (create_auction
      // /list both pull the card into custody), so a card the seller doesn't own —
      // or already has tied up in another listing — traps the contract with a
      // cryptic balance error. A freshly minted card is just issued to the seller,
      // so only an existing catalog pick needs the check. `api.cards(address)`
      // returns just the cards that wallet holds; if the lookup itself fails we
      // defer to the server/on-chain guard rather than block on a transient error.
      if (!isMint) {
        let held: Card[] | null = null;
        try {
          held = await api.cards(address);
        } catch {
          held = null;
        }
        if (held && !held.some((c) => c.id === cardId)) {
          setState({ publishing: false });
          return showToast("You don't hold this card on-chain — it may already be listed", 'outbid');
        }
      }

      if (isMint && !ref.current.mintedCard) {
        const minted = await mintCard({
          name: f.title.trim(),
          set: f.setLine.trim(),
          rarity: f.rarity,
          imageUrl: f.image as string,
          supply: Math.max(1, Math.floor(Number(f.supply) || 1)),
          royaltyBps: Math.round(Math.min(10, Math.max(0, Number(f.royaltyPct) || 0)) * 100),
        });
        cardId = minted.id;
        sacAddress = minted.sacAddress;
        setState((s) => ({ mintedCard: minted, form: { ...s.form, cardId: minted.id } }));
      }

      let hash: string;
      if (isAuction) {
        hash = await runAction('create_auction', {
          cardId,
          seller: address,
          startPriceUsdc: formatAmount(start),
          reservePriceUsdc: formatAmount(reserve),
          durationSecs: f.duration * 86400,
        });
      } else if (walletKind === 'passkey') {
        if (!sacAddress) {
          sacAddress = catalog.find((c) => c.id === cardId)?.sacAddress ?? null;
        }
        if (!sacAddress) throw new Error('Card asset contract not deployed');
        hash = await passkeyList(cardId, sacAddress, formatAmount(start), f.fulfillment);
      } else {
        hash = await runAction('list', {
          cardId,
          seller: address,
          priceUsdc: formatAmount(start),
          fulfillment: f.fulfillment,
        });
      }
      const card = formToCard({ ...f, cardId }, hash);
      setState((s) => ({ cards: [card, ...s.cards], sellStep: 4, lastHash: hash, publishing: false }));
      window.scrollTo(0, 0);
    } catch (err) {
      setState({ publishing: false });
      showToast((err as Error).message || 'Listing failed', 'outbid');
    }
  };

  // ----- wallet menu / nav / filters -----
  const onWalletClick = () => {
    const { address, connecting, connect } = wallet;
    if (connecting) return;
    if (address) setState((s) => ({ walletMenuOpen: !s.walletMenuOpen, addressCopied: false }));
    else connect();
  };
  const closeWalletMenu = () => setState({ walletMenuOpen: false });
  const toggleFilters = () => setState((s) => ({ filtersOpen: !s.filtersOpen }));
  const closeFilters = () => setState({ filtersOpen: false });
  const toggleNavMenu = () => setState((s) => ({ navMenuOpen: !s.navMenuOpen }));
  const closeNavMenu = () => setState({ navMenuOpen: false });
  const disconnectWallet = () => {
    wallet.disconnect();
    setState({ walletMenuOpen: false, addressCopied: false });
  };
  const copyAddress = async () => {
    const { address } = wallet;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setState({ addressCopied: true });
      if (copyT.current) clearTimeout(copyT.current);
      copyT.current = setTimeout(() => setState({ addressCopied: false }), 1600);
    } catch {
      showToast('Could not copy — copy it manually', 'outbid');
    }
  };

  const value: TopDeckContext = {
    state,
    wallet,
    orders,
    catalog,
    explorerTx,
    explorerAddress: explorerAccount,
    getCard,
    open, goHome, goBrowse, goMyBids, goSell, goLeaderboard, goPortfolio, goFaucet, goTrade, goTrades, goProfile, goStore, openOrders, openGuide, closeGuide, viewCard,
    refresh,
    setPage, toggleCat, toggleRarity, toggleFlag, setPrice, setSort, clearFilters, setQuery, clearQuery,
    toggleFilters, closeFilters,
    setMyBidsTab,
    openBid, openBidFor, closeBid, onBidInput, setBid, placeBid, settleAuction, cancelAuction,
    selectPayAsset, buyNow, payWithPasskey, escrowBuy, retryBuyNow, dismissResidual,
    doOrderAction, resolveDispute, setOrdersArbiter,
    setSellMode, setForm, readImageFile, onPickImage, onDropImage, setDragOver, selectCatalogCard,
    sellNext, sellBack, listAnother, publishListing,
    setLbTab,
    onWalletClick, closeWalletMenu, toggleNavMenu, closeNavMenu, disconnectWallet, copyAddress,
    showToast,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ===========================================================================
// Outer provider: real data + wallet wiring, with a splash while loading.
// ===========================================================================

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: '#fff7ec', color: INK, fontFamily: "'DM Sans',system-ui" }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 40, letterSpacing: '-.03em' }}>TOP<span style={{ color: '#ff4d3d' }}>DECK</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d3d', animation: 'pulseDot 1.3s infinite' }} />Loading marketplace…
      </div>
    </div>
  );
}

/** Shown when the first listings fetch fails — never a fabricated fallback. */
function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#fff7ec', color: INK, fontFamily: "'DM Sans',system-ui", padding: 24, textAlign: 'center' }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 40, letterSpacing: '-.03em' }}>TOP<span style={{ color: '#ff4d3d' }}>DECK</span></div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>Couldn’t load the marketplace</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'rgba(26,19,5,.6)', maxWidth: 380 }}>
        We couldn’t reach the listings service. Check your connection and try again.
      </div>
      <div onClick={onRetry} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '12px 22px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Retry</div>
    </div>
  );
}

export function TopDeckProvider({ children }: { children: ReactNode }) {
  const {
    address,
    connecting,
    walletKind,
    passkeyAvailable,
    connect,
    connectViaPasskey,
    disconnect,
    runAction,
    passkeyBuyNow,
    passkeyList,
    escrowPurchase,
    orderAction,
    mintCard,
    payWithAsset,
  } = useWallet();
  const { data: listings, isPending: listingsPending, isError: listingsError } = useListings();
  const { data: auctions = [] } = useAuctions();

  // Map live listings + open auctions to seed cards. Tri-state: `null` while the
  // first listings fetch is in flight, the `'error'` sentinel when it fails,
  // otherwise the (possibly empty) real lots. We never fabricate demo cards — an
  // empty or errored response renders an honest empty/error state instead.
  const seed = useMemo<TopCard[] | 'error' | null>(() => {
    if (listingsPending) return null;
    if (listingsError || !listings) return 'error';
    const auctionCards = auctions
      .filter((a) => a.card)
      .map((a) => mapAuction(a, [], address ?? undefined));
    const listingCards = listings.filter((l) => l.card).map((l) => mapListing(l));
    return [...auctionCards, ...listingCards];
  }, [listings, listingsPending, listingsError, auctions, address]);

  const { data: catalog = [] } = useCards(address);
  const ordersQuery = useOrders(address);
  const disputedQuery = useDisputedOrders(!!address);
  const queryClient = useQueryClient();
  const refreshOrders = useCallback(
    () => invalidateOrders(queryClient, address),
    [queryClient, address],
  );

  // Pull the authoritative open listings + auctions and map them to browse cards.
  // `fetchQuery` also writes through to the shared cache, so the 5s polls pick up
  // from the freshly refreshed data rather than refetching twice.
  const fetchFreshCards = useCallback(async (): Promise<TopCard[]> => {
    const [freshListings, freshAuctions] = await Promise.all([
      queryClient.fetchQuery({ queryKey: queryKeys.listings(), queryFn: () => api.listings() }),
      queryClient.fetchQuery({ queryKey: queryKeys.auctions(), queryFn: () => api.auctions('open') }),
    ]);
    const auctionCards = freshAuctions
      .filter((a) => a.card)
      .map((a) => mapAuction(a, [], address ?? undefined));
    const listingCards = freshListings.filter((l) => l.card).map((l) => mapListing(l));
    return [...auctionCards, ...listingCards];
  }, [queryClient, address]);

  const orderActionMut = useMutation({
    mutationFn: (v: { action: OrderAction; orderId: string; contractOrderId: number }) =>
      orderAction(v.action, v.orderId, v.contractOrderId),
    onSuccess: refreshOrders,
  });
  const escrowPurchaseMut = useMutation({
    mutationFn: (v: { listingId: string; contractListingId: number }) =>
      escrowPurchase(v.listingId, v.contractListingId),
    onSuccess: refreshOrders,
  });
  const resolveOrderMut = useMutation({
    mutationFn: (v: { orderId: string; refund: boolean }) =>
      api.resolveOrder(v.orderId, v.refund).then((r) => r.hash),
    onSuccess: refreshOrders,
  });

  if (seed === null) return <Splash />;
  if (seed === 'error')
    return <ErrorPanel onRetry={() => queryClient.invalidateQueries({ queryKey: queryKeys.listings() })} />;

  const wallet: WalletProps = {
    address,
    connecting,
    walletKind,
    passkeyAvailable,
    connect,
    connectViaPasskey,
    disconnect,
    runAction: (action, body) => runAction(action, body),
    passkeyBuyNow,
    passkeyList,
    escrowPurchase: (listingId, contractListingId) =>
      escrowPurchaseMut.mutateAsync({ listingId, contractListingId }),
    orderAction: (action, orderId, contractOrderId) =>
      orderActionMut.mutateAsync({ action, orderId, contractOrderId }),
    mintCard,
    payWithAsset,
  };

  const orders: OrdersProps = {
    data: ordersQuery.data ?? [],
    disputed: disputedQuery.data ?? [],
    loading: ordersQuery.isLoading,
    error: !address
      ? 'Connect a wallet to see your orders'
      : ordersQuery.error
        ? (ordersQuery.error as Error).message
        : null,
    resolve: (orderId, refund) => resolveOrderMut.mutateAsync({ orderId, refund }),
    refresh: refreshOrders,
  };

  return (
    <TopDeckStore wallet={wallet} orders={orders} seedCards={seed} fetchFreshCards={fetchFreshCards} catalog={catalog}>
      {children}
    </TopDeckStore>
  );
}

'use client';

/**
 * TopDeck — the auction-marketplace UI, ported from the Claude Design source
 * (TopDeck.dc.html) into a React class component.
 *
 * Real (wired to the marketplace API / wallet):
 *   - the top-nav wallet control (connect / disconnect / address)
 *   - the browse grid + detail data (real listings, passed in as `seedCards`)
 *   - the Sell flow's publish step → `runAction('list', …)` → on-chain tx
 *
 * Simulated (client-side only; the fixed-price backend has no bidding contract):
 *   - placing bids, buy-now, countdown timers, watchlist, bid history, toasts
 */

import { Component, type ChangeEvent, type CSSProperties, type DragEvent } from 'react';
import type { Card, MintCardRequest, PathQuoteResponse, StellarAsset } from '@cardmkt/shared';
import { XLM_ASSET, formatAmount } from '@cardmkt/shared';
import { ApiRequestError, api } from '@/lib/api';
import {
  type Rarity,
  type TopCard,
  fmtAgo,
  fmtLeft,
  increment,
  mapRarity,
  money,
  rarityArt,
  rarityMeta,
  shorten,
} from './lib';

const INK = '#1a1305';
const DISPLAY = "'Bricolage Grotesque'";
const SANS = "'DM Sans',system-ui";
const PAGE_SIZE = 12; // lots per browse page (multiple of 3 to fill the grid)

interface WalletProps {
  address: string | null;
  connecting: boolean;
  /** Whether the connected wallet is a passkey smart wallet vs. a classic one. */
  walletKind: 'classic' | 'passkey' | null;
  /** Whether passkey checkout can be offered on this device/build. */
  passkeyAvailable: boolean;
  connect: () => void;
  /** Connect (or create) a passkey smart wallet via Face ID / Touch ID. */
  connectViaPasskey: () => Promise<void>;
  disconnect: () => void;
  runAction: (action: 'list', body: Record<string, unknown>) => Promise<string>;
  /** Buy a real listing with the passkey smart wallet (gasless). Returns tx hash. */
  passkeyBuyNow: (listingId: string, contractListingId: number) => Promise<string>;
  /** List a card with the passkey smart wallet (gasless). Returns tx hash. */
  passkeyList: (cardId: string, cardToken: string, priceUsdc: string) => Promise<string>;
  /** Mint (issue) a brand-new card owned by the connected wallet. */
  mintCard: (meta: Omit<MintCardRequest, 'owner'>) => Promise<Card>;
  /** Convert a held asset into the settlement USDC (pay-with-any-asset). */
  payWithAsset: (quote: PathQuoteResponse) => Promise<string | null>;
}

/** Source assets the buyer can pay with. USDC is the no-conversion default. */
type PayAssetId = 'USDC' | 'XLM';
const PAY_ASSETS: Array<{ id: PayAssetId; label: string; asset: StellarAsset | null }> = [
  { id: 'USDC', label: 'USDC', asset: null },
  { id: 'XLM', label: 'XLM', asset: XLM_ASSET },
];

interface Props {
  wallet: WalletProps;
  seedCards: TopCard[];
  catalog: Card[];
  explorerTx: (hash: string) => string;
  /** Build an explorer URL for the connected wallet address. */
  explorerAddress: (address: string) => string;
}

interface Form {
  cardId: string;
  title: string;
  setLine: string;
  category: string;
  rarity: Rarity;
  image?: string;
  graded: boolean;
  grade: string;
  condition: string;
  startBid: string;
  buyNowOn: boolean;
  buyNow: string;
  duration: number;
  /** Copies to issue when minting a brand-new card. */
  supply: string;
  /** Creator royalty percent (0–10) when minting a brand-new card. */
  royaltyPct: string;
}

interface State {
  screen: 'browse' | 'detail' | 'mybids' | 'sell';
  selectedId: string | null;
  query: string;
  sort: string;
  facets: { cats: string[]; rarities: string[]; graded: boolean; buyNow: boolean; ending: boolean; price: string };
  bidOpen: boolean;
  bidAmount: string;
  toast: string | null;
  toastKind: 'win' | 'outbid';
  watched: Record<string, boolean>;
  status: Record<string, string>;
  myMax: Record<string, number>;
  sellStep: number;
  /** Step-1 mode: list a card the wallet already holds, or mint a brand-new one. */
  sellMode: 'hold' | 'mint';
  /** The card minted this session (set after a successful mint), to avoid re-minting on retry. */
  mintedCard: Card | null;
  myBidsTab: 'bidding' | 'selling';
  publishing: boolean;
  lastHash: string | null;
  /** True while a card photo is being dragged over the upload dropzone. */
  dragOver: boolean;
  form: Form;
  cards: TopCard[];
  now: number;
  page: number;
  /** Source asset selected in the buy panel (USDC = no conversion). */
  payAsset: PayAssetId;
  /** Live conversion quote for the selected non-USDC asset. */
  quote: PathQuoteResponse | null;
  quoting: boolean;
  /** User-facing quote/conversion error (NO_PATH, INSUFFICIENT_BALANCE, …). */
  quoteErr: string | null;
  /** A passkey "Pay with Face ID" checkout is in flight. */
  paying: boolean;
  /** User-facing passkey-checkout error (declined / relay failure). */
  payErr: string | null;
  /** Whether the connected-wallet management menu is open. */
  walletMenuOpen: boolean;
  /** True briefly after the address is copied, to flip the copy label. */
  addressCopied: boolean;
}

const EMPTY_FORM: Form = {
  cardId: '', title: '', setLine: '', category: 'Other', rarity: 'rare', image: undefined,
  graded: false, grade: 'PSA 10', condition: 'Near Mint', startBid: '', buyNowOn: false, buyNow: '', duration: 3,
  supply: '1', royaltyPct: '0',
};

export class TopDeckApp extends Component<Props, State> {
  private tick: ReturnType<typeof setInterval> | null = null;
  private toastT: ReturnType<typeof setTimeout> | null = null;
  private rivalT: ReturnType<typeof setTimeout> | null = null;
  private copyT: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      screen: 'browse', selectedId: null, query: '', sort: 'ending', now: Date.now(), page: 1,
      facets: { cats: [], rarities: [], graded: false, buyNow: false, ending: false, price: 'any' },
      bidOpen: false, bidAmount: '', toast: null, toastKind: 'win',
      watched: {}, status: {}, myMax: {},
      sellStep: 1, sellMode: 'hold', mintedCard: null, myBidsTab: 'bidding', publishing: false, lastHash: null, dragOver: false,
      form: { ...EMPTY_FORM },
      cards: props.seedCards,
      payAsset: 'USDC', quote: null, quoting: false, quoteErr: null,
      paying: false, payErr: null,
      walletMenuOpen: false, addressCopied: false,
    };
  }

  componentDidMount() {
    this.tick = setInterval(() => {
      if (!this.state.bidOpen && this.state.screen !== 'sell') this.setState({ now: Date.now() });
    }, 1000);
  }

  componentWillUnmount() {
    if (this.tick) clearInterval(this.tick);
    if (this.toastT) clearTimeout(this.toastT);
    if (this.rivalT) clearTimeout(this.rivalT);
    if (this.copyT) clearTimeout(this.copyT);
  }

  // ----- navigation -----
  private getCard(id: string | null) {
    return this.state.cards.find((c) => c.id === id);
  }
  private open = (id: string) => { this.setState({ screen: 'detail', selectedId: id, payAsset: 'USDC', quote: null, quoteErr: null }); window.scrollTo(0, 0); };
  private goHome = () => { this.setState({ screen: 'browse' }); window.scrollTo(0, 0); };
  private goMyBids = () => { this.setState({ screen: 'mybids' }); window.scrollTo(0, 0); };
  private goSell = () => { this.setState({ screen: 'sell', sellStep: 1, mintedCard: null }); window.scrollTo(0, 0); };
  /** Switch step-1 mode; clears the held-card selection so validation re-evaluates. */
  private setSellMode = (mode: 'hold' | 'mint') =>
    this.setState((s) => ({ sellMode: mode, mintedCard: null, form: { ...s.form, cardId: '' } }));
  private setMyBidsTab = (t: 'bidding' | 'selling') => this.setState({ myBidsTab: t });

  // ----- pagination -----
  // Any change to the result set (filter/sort/search) sends the user back to
  // page 1, otherwise they could be stranded on a now-empty trailing page.
  private setPage = (p: number) => { this.setState({ page: p }); window.scrollTo(0, 0); };

  // ----- filters -----
  private toggleCat = (v: string) =>
    this.setState((s) => ({ page: 1, facets: { ...s.facets, cats: s.facets.cats.includes(v) ? s.facets.cats.filter((x) => x !== v) : [...s.facets.cats, v] } }));
  private toggleRarity = (v: string) =>
    this.setState((s) => ({ page: 1, facets: { ...s.facets, rarities: s.facets.rarities.includes(v) ? s.facets.rarities.filter((x) => x !== v) : [...s.facets.rarities, v] } }));
  private toggleFlag = (k: 'graded' | 'buyNow' | 'ending') =>
    this.setState((s) => ({ page: 1, facets: { ...s.facets, [k]: !s.facets[k] } }));
  private setPrice = (v: string) => this.setState((s) => ({ page: 1, facets: { ...s.facets, price: v } }));
  private setSort = (v: string) => this.setState({ page: 1, sort: v });
  private clearFilters = () =>
    this.setState({ page: 1, query: '', sort: 'ending', facets: { cats: [], rarities: [], graded: false, buyNow: false, ending: false, price: 'any' } });

  // ----- search -----
  private setQuery = (e: React.ChangeEvent<HTMLInputElement>) =>
    this.setState((s) => ({ page: 1, query: e.target.value, screen: s.screen === 'detail' || s.screen === 'sell' ? 'browse' : s.screen }));
  private clearQuery = () => this.setState({ page: 1, query: '' });

  // ----- watch -----
  private toggleWatch = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    this.setState((s) => ({ watched: { ...s.watched, [id]: !s.watched[id] } }));
  };

  // ----- toast -----
  private showToast(text: string, kind: 'win' | 'outbid' = 'win') {
    if (this.toastT) clearTimeout(this.toastT);
    this.setState({ toast: text, toastKind: kind });
    this.toastT = setTimeout(() => this.setState({ toast: null }), 3400);
  }

  // ----- bidding (simulated) -----
  private openBid = () => {
    const c = this.getCard(this.state.selectedId);
    if (!c) return;
    const min = c.currentBid + increment(c.currentBid);
    this.setState({ bidOpen: true, bidAmount: String(min) });
  };
  private openBidFor = (id: string) => {
    const c = this.getCard(id);
    if (!c) return;
    const min = c.currentBid + increment(c.currentBid);
    this.setState({ selectedId: id, bidOpen: true, bidAmount: String(min) });
  };
  private closeBid = () => this.setState({ bidOpen: false });
  private onBidInput = (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ bidAmount: e.target.value });
  private setBid = (v: number) => this.setState({ bidAmount: String(v) });

  private confirmBid = () => {
    const c = this.getCard(this.state.selectedId);
    if (!c) return;
    const min = c.currentBid + increment(c.currentBid);
    const amt = Number(this.state.bidAmount);
    if (!amt || amt < min) return;
    this.setState((s) => ({
      cards: s.cards.map((x) =>
        x.id === c.id ? { ...x, currentBid: amt, bids: [{ bidder: 'You', amount: amt, at: Date.now(), you: true }, ...x.bids] } : x,
      ),
      status: { ...s.status, [c.id]: 'winning' },
      myMax: { ...s.myMax, [c.id]: amt },
      bidOpen: false,
    }));
    this.showToast("You're the highest bidder!", 'win');
    this.scheduleRival(c.id, amt);
  };

  private scheduleRival(id: string, beat: number) {
    if (this.rivalT) clearTimeout(this.rivalT);
    this.rivalT = setTimeout(() => {
      const c = this.getCard(id);
      if (!c || this.state.selectedId !== id) return;
      if (c.currentBid !== beat) return;
      if (Math.random() < 0.45) return;
      const raise = c.currentBid + increment(c.currentBid);
      this.setState((s) => ({
        cards: s.cards.map((x) =>
          x.id === id ? { ...x, currentBid: raise, bids: [{ bidder: 'DragonHoard', amount: raise, at: Date.now() }, ...x.bids] } : x,
        ),
        status: { ...s.status, [id]: 'outbid' },
      }));
      this.showToast('Outbid by DragonHoard — bid again to win!', 'outbid');
    }, 4200);
  }

  /** Human-readable message for a pay-with-any-asset failure code. */
  private quoteError(err: unknown): string {
    if (err instanceof ApiRequestError) {
      if (err.code === 'NO_PATH') return 'No swap route for this asset right now';
      if (err.code === 'INSUFFICIENT_BALANCE') return 'Not enough of this asset to cover the price';
      if (err.code === 'ACCOUNT_NOT_FOUND') return 'Fund your wallet to pay with this asset';
      return err.message;
    }
    return 'Could not fetch a quote';
  }

  /** Switch the source asset and, for a non-USDC pick, fetch a live quote. */
  private selectPayAsset = (id: PayAssetId) => {
    this.setState({ payAsset: id, quote: null, quoteErr: null });
    const def = PAY_ASSETS.find((a) => a.id === id);
    if (!def?.asset) return; // USDC — no conversion needed
    const c = this.getCard(this.state.selectedId);
    const { address } = this.props.wallet;
    if (!c || !address) {
      if (!address) this.setState({ quoteErr: 'Connect your wallet to see a quote' });
      return;
    }
    const price = c.buyNow > 0 ? c.buyNow : c.currentBid;
    this.setState({ quoting: true });
    api
      .quotePath({ buyer: address, sourceAsset: def.asset, destUsdc: formatAmount(price) })
      .then((quote) => {
        // Ignore a stale response if the user switched assets meanwhile.
        if (this.state.selectedId === c.id && this.state.payAsset === id) {
          this.setState({ quote, quoting: false });
        }
      })
      .catch((err) => {
        if (this.state.selectedId === c.id && this.state.payAsset === id) {
          this.setState({ quoting: false, quoteErr: this.quoteError(err) });
        }
      });
  };

  private buyNow = async () => {
    const c = this.getCard(this.state.selectedId);
    if (!c) return;
    const { address, connect, payWithAsset } = this.props.wallet;
    const def = PAY_ASSETS.find((a) => a.id === this.state.payAsset);

    // Default USDC path stays simulated (no on-chain buy contract in this skin).
    if (!def?.asset) {
      this.setState((s) => ({ status: { ...s.status, [c.id]: 'won' } }));
      this.showToast('Purchased! ' + c.name + ' is yours 🎉', 'win');
      return;
    }

    // Pay-with-any-asset: convert to USDC on-chain, then settle.
    if (!address) {
      this.showToast('Connect your wallet to pay', 'outbid');
      connect();
      return;
    }
    const quote = this.state.quote;
    if (!quote) {
      this.showToast('Fetching a quote — try again in a moment', 'outbid');
      return;
    }
    this.setState({ quoting: true, quoteErr: null });
    try {
      await payWithAsset(quote);
      this.setState((s) => ({ status: { ...s.status, [c.id]: 'won' }, quoting: false }));
      this.showToast(`Paid with ${def.label} — ${c.name} is yours 🎉`, 'win');
    } catch (err) {
      this.setState({ quoting: false, quoteErr: this.quoteError(err) });
      this.showToast(this.quoteError(err), 'outbid');
    }
  };

  // ----- passkey "Pay with Face ID" checkout -----
  private payWithPasskey = async () => {
    const c = this.getCard(this.state.selectedId);
    if (!c?.real || c.contractListingId == null || !c.listingId) return;
    const { passkeyBuyNow, walletKind, connectViaPasskey } = this.props.wallet;
    this.setState({ paying: true, payErr: null });
    try {
      // One flow: connect/create the passkey wallet if needed, then one
      // biometric prompt authorizes the gasless purchase.
      if (walletKind !== 'passkey') await connectViaPasskey();
      const hash = await passkeyBuyNow(c.listingId, c.contractListingId);
      this.setState((s) => ({ status: { ...s.status, [c.id]: 'won' }, paying: false, lastHash: hash }));
      this.showToast(`Face ID confirmed — ${c.name} is yours 🎉`, 'win');
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : 'Purchase cancelled — try again';
      this.setState({ paying: false, payErr: msg });
      this.showToast(msg, 'outbid');
    }
  };

  // ----- sell flow -----
  private fileInput: HTMLInputElement | null = null;
  private setForm = (k: keyof Form, v: unknown) => this.setState((s) => ({ form: { ...s.form, [k]: v } }));

  /**
   * Downscale a data URL through a canvas so the stored image stays small. A raw
   * photo's base64 data URL is ~1.37× its byte size, so an 8 MB upload would be
   * ~11M chars — far past what mint accepts (or what belongs in a DB row). We cap
   * the longest edge and re-encode as JPEG, which keeps a card photo well under a
   * few hundred KB while staying sharp at card size.
   */
  private compressImage(dataUrl: string): Promise<string> {
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
        // White matte so transparent PNGs don't turn black under JPEG.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      };
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    });
  }

  /** Read a user-chosen image file, downscale it, and store it for preview + mint. */
  private readImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return this.showToast('Please choose an image file', 'outbid');
    if (file.size > 8 * 1024 * 1024) return this.showToast('Image must be under 8 MB', 'outbid');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        this.setForm('image', await this.compressImage(String(reader.result)));
      } catch {
        this.showToast('Could not process that image — try another', 'outbid');
      }
    };
    reader.onerror = () => this.showToast('Could not read that file — try another', 'outbid');
    reader.readAsDataURL(file);
  };

  private onPickImage = (e: ChangeEvent<HTMLInputElement>) => {
    this.readImageFile(e.target.files?.[0]);
    e.target.value = ''; // let the user re-pick the same file after removing it
  };

  private onDropImage = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    this.setState({ dragOver: false });
    this.readImageFile(e.dataTransfer.files?.[0]);
  };

  private selectCatalogCard = (c: Card) =>
    this.setState((s) => ({
      form: { ...s.form, cardId: c.id, title: c.name, setLine: c.set, rarity: mapRarity(c.rarity), image: c.imageUrl, category: 'Other' },
    }));
  private sellNext = () => { this.setState((s) => ({ sellStep: Math.min(3, s.sellStep + 1) })); window.scrollTo(0, 0); };
  private sellBack = () => { this.setState((s) => ({ sellStep: Math.max(1, s.sellStep - 1) })); window.scrollTo(0, 0); };
  private listAnother = () => { this.setState({ sellStep: 1, form: { ...EMPTY_FORM }, lastHash: null, mintedCard: null }); window.scrollTo(0, 0); };

  private formToCard(f: Form, hash: string): TopCard {
    const start = Number(f.startBid) || 0;
    const buy = f.buyNowOn ? Number(f.buyNow) || 0 : 0;
    const image = f.image;
    return {
      id: 'self-' + hash.slice(0, 12), cardId: f.cardId, real: true, mine: true,
      name: f.title || 'Untitled card', rarity: f.rarity,
      condition: f.graded ? f.grade + ' · Graded' : f.condition, grade: f.graded ? f.grade : 'Raw',
      cats: [f.category], art: image ? `center/cover no-repeat url("${image}")` : rarityArt(f.rarity),
      image, sellerArt: 'linear-gradient(135deg,#ff4d3d,#ffb83d)',
      currentBid: start, endsAt: Date.now() + f.duration * 86400000, buyNow: buy,
      seller: 'You', sellerRating: 'New', sellerSales: '0',
      setLine: (f.setLine || 'YOUR LISTING').toUpperCase(), bids: [],
    };
  }

  private publishListing = async () => {
    const f = this.state.form;
    const isMint = this.state.sellMode === 'mint';
    const start = Number(f.startBid) || 0;
    if (isMint) {
      if (!f.title.trim()) return this.showToast('Name your new card', 'outbid');
      if (!f.image) return this.showToast('Add a photo for your new card', 'outbid');
    } else if (!f.cardId) {
      return this.showToast('Pick a card to list', 'outbid');
    }
    if (!(start > 0)) return this.showToast('Enter a starting bid', 'outbid');
    const { address, walletKind, connect, runAction, passkeyList, mintCard } = this.props.wallet;
    if (!address) {
      this.showToast('Connect your wallet to list', 'outbid');
      connect();
      return;
    }
    this.setState({ publishing: true });
    try {
      // Mint mode: issue the card first (reusing a prior mint on retry), then list
      // the freshly minted token. `mintedCard.sacAddress` feeds the passkey path.
      let cardId = f.cardId;
      let sacAddress = this.state.mintedCard?.sacAddress ?? null;
      if (isMint && !this.state.mintedCard) {
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
        this.setState((s) => ({ mintedCard: minted, form: { ...s.form, cardId: minted.id } }));
      }

      let hash: string;
      if (walletKind === 'passkey') {
        // A smart-wallet seller (`C…`) builds + passkey-signs the `list` call and
        // relays it gaslessly; the classic `G…`-only build path can't sign for it.
        if (!sacAddress) {
          sacAddress = this.props.catalog.find((c) => c.id === cardId)?.sacAddress ?? null;
        }
        if (!sacAddress) throw new Error('Card asset contract not deployed');
        hash = await passkeyList(cardId, sacAddress, formatAmount(start));
      } else {
        hash = await runAction('list', { cardId, seller: address, priceUsdc: formatAmount(start) });
      }
      const card = this.formToCard({ ...f, cardId }, hash);
      this.setState((s) => ({ cards: [card, ...s.cards], sellStep: 4, lastHash: hash, publishing: false }));
      window.scrollTo(0, 0);
    } catch (err) {
      this.setState({ publishing: false });
      this.showToast((err as Error).message || 'Listing failed', 'outbid');
    }
  };

  // ----- wallet -----
  // Connected: the chip toggles the management menu (view / copy / explorer /
  // disconnect). Disconnected: it opens the wallet picker directly.
  private onWalletClick = () => {
    const { address, connecting, connect } = this.props.wallet;
    if (connecting) return;
    if (address) this.setState((s) => ({ walletMenuOpen: !s.walletMenuOpen, addressCopied: false }));
    else connect();
  };

  private closeWalletMenu = () => this.setState({ walletMenuOpen: false });

  private disconnectWallet = () => {
    this.props.wallet.disconnect();
    this.setState({ walletMenuOpen: false, addressCopied: false });
  };

  /** Copy the full connected address, flipping the menu label to "Copied" briefly. */
  private copyAddress = async () => {
    const { address } = this.props.wallet;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      this.setState({ addressCopied: true });
      if (this.copyT) clearTimeout(this.copyT);
      this.copyT = setTimeout(() => this.setState({ addressCopied: false }), 1600);
    } catch {
      this.showToast('Could not copy — copy it manually', 'outbid');
    }
  };

  /** The connected-wallet management dropdown: view, copy, explorer, disconnect. */
  private renderWalletMenu(address: string) {
    const { walletKind } = this.props.wallet;
    const copied = this.state.addressCopied;
    const action = (label: string, onClick: () => void, danger = false): React.ReactNode => (
      <div
        onClick={onClick}
        style={{ fontSize: 12.5, fontWeight: 700, padding: '9px 12px', borderRadius: 8, border: `2px solid ${INK}`, background: danger ? '#ff4d3d' : '#fff', color: danger ? '#fff' : INK, cursor: 'pointer', textAlign: 'center' }}
      >
        {label}
      </div>
    );
    return (
      <>
        {/* click-outside backdrop */}
        <div onClick={this.closeWalletMenu} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 41, width: 260, background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', background: '#ffd84d', borderBottom: `3px solid ${INK}` }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.6)' }}>CONNECTED WALLET</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: INK, color: '#fff' }}>
              {walletKind === 'passkey' ? '⚡ Passkey' : 'Classic'}
            </span>
          </div>
          <div style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div
              onClick={this.copyAddress}
              title="Click to copy"
              style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12, fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.5, padding: '9px 11px', background: '#fff7ec', border: `2px solid ${INK}`, borderRadius: 8, cursor: 'pointer' }}
            >
              {address}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {action(copied ? '✓ Copied' : 'Copy', this.copyAddress)}
              {action('Explorer ↗', () => window.open(this.props.explorerAddress(address), '_blank', 'noopener,noreferrer'))}
            </div>
            {action('Disconnect', this.disconnectWallet, true)}
          </div>
        </div>
      </>
    );
  }

  // ===== render helpers =====
  private cardTile(c: TopCard, height: number) {
    const rm = rarityMeta(c.rarity);
    const left = c.endsAt - this.state.now;
    const ending = left < 3600000;
    const watched = this.state.watched[c.id];
    return (
      <div
        key={c.id}
        className="td-lift"
        onClick={() => this.open(c.id)}
        style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, overflow: 'hidden', boxShadow: `4px 4px 0 ${INK}`, cursor: 'pointer' }}
      >
        <div style={{ position: 'relative', height, background: c.art }}>
          <div style={{ position: 'absolute', top: 10, left: 10, fontSize: 10, fontWeight: 800, letterSpacing: '.03em', padding: '4px 10px', borderRadius: 7, background: rm.bg, color: rm.color, border: `2px solid ${INK}` }}>{rm.label}</div>
          <div onClick={(e) => this.toggleWatch(e, c.id)} style={{ position: 'absolute', top: 9, right: 9, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: watched ? '#ff4d3d' : '#fff', border: `2px solid ${INK}`, fontSize: 14, color: watched ? '#fff' : 'rgba(26,19,5,.3)' }}>♥</div>
          <div style={{ position: 'absolute', bottom: 10, right: 10, fontSize: 11, fontWeight: 800, padding: '4px 9px', borderRadius: 7, background: ending ? '#ff4d3d' : INK, color: '#fff', border: `2px solid ${INK}` }}>⏱ {fmtLeft(left)}</div>
        </div>
        <div style={{ padding: '13px 14px 15px' }}>
          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{c.name}</div>
          <div style={{ fontSize: 11.5, color: 'rgba(26,19,5,.5)', marginTop: 3, fontWeight: 500 }}>{c.condition}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 13 }}>
            <div>
              <div style={{ fontSize: 10.5, color: 'rgba(26,19,5,.5)', fontWeight: 600 }}>Current bid</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>{money(c.currentBid)}</div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>{c.bids.length} bids</div>
          </div>
        </div>
      </div>
    );
  }

  private chipStyle(active: boolean): CSSProperties {
    return { background: active ? INK : '#fff', color: active ? '#fff' : INK };
  }

  // ----- pagination controls -----
  // Build a windowed list of page numbers around the current page, with '…'
  // gaps so the bar stays compact even with many pages (e.g. 1 … 4 5 6 … 20).
  private pageItems(page: number, total: number): Array<number | 'gap'> {
    const items = new Set<number>([1, total, page, page - 1, page + 1]);
    const pages = [...items].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
    const out: Array<number | 'gap'> = [];
    let prev = 0;
    pages.forEach((p) => {
      if (prev && p - prev > 1) out.push('gap');
      out.push(p);
      prev = p;
    });
    return out;
  }

  private renderPagination(page: number, total: number, count: number, start: number, shown: number) {
    const btn = (label: React.ReactNode, opts: { active?: boolean; disabled?: boolean; onClick?: () => void; key: string }) => (
      <div
        key={opts.key}
        onClick={opts.disabled ? undefined : opts.onClick}
        aria-current={opts.active ? 'page' : undefined}
        style={{
          minWidth: 38, textAlign: 'center', fontSize: 13, fontWeight: 800, padding: '9px 12px',
          border: `2.5px solid ${INK}`, borderRadius: 9, fontFamily: DISPLAY,
          background: opts.active ? INK : '#fff', color: opts.active ? '#fff' : INK,
          boxShadow: opts.active ? 'none' : `2px 2px 0 ${INK}`,
          cursor: opts.disabled ? 'not-allowed' : 'pointer', opacity: opts.disabled ? 0.4 : 1,
        }}
      >
        {label}
      </div>
    );
    return (
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', justifyContent: 'center' }}>
          {btn('← Prev', { key: 'prev', disabled: page <= 1, onClick: () => this.setPage(page - 1) })}
          {this.pageItems(page, total).map((it, i) =>
            it === 'gap'
              ? <div key={`gap-${i}`} style={{ fontSize: 13, fontWeight: 800, color: 'rgba(26,19,5,.4)', padding: '0 2px' }}>…</div>
              : btn(it, { key: `p-${it}`, active: it === page, onClick: () => this.setPage(it) }),
          )}
          {btn('Next →', { key: 'next', disabled: page >= total, onClick: () => this.setPage(page + 1) })}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>
          Showing {start + 1}–{start + shown} of {count} lots
        </div>
      </div>
    );
  }

  render() {
    const st = this.state;
    const fc = st.facets;
    const wallet = this.props.wallet;

    // filtered + sorted browse list
    const query = st.query.trim().toLowerCase();
    let list = st.cards.filter((c) => {
      if (query) {
        const hay = `${c.name} ${c.setLine} ${c.condition} ${c.seller} ${c.rarity}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      if (fc.cats.length && !fc.cats.some((cat) => c.cats.includes(cat))) return false;
      if (fc.rarities.length && !fc.rarities.includes(c.rarity)) return false;
      if (fc.graded && !c.cats.includes('Graded')) return false;
      if (fc.buyNow && !(c.buyNow > 0)) return false;
      if (fc.ending && c.endsAt - st.now >= 3600000) return false;
      if (fc.price !== 'any') {
        const p = c.currentBid;
        if (fc.price === 'lt100' && !(p < 100)) return false;
        if (fc.price === '100to1k' && !(p >= 100 && p <= 1000)) return false;
        if (fc.price === 'gt1k' && !(p > 1000)) return false;
      }
      return true;
    });
    const sortFns: Record<string, (a: TopCard, b: TopCard) => number> = {
      ending: (a, b) => a.endsAt - st.now - (b.endsAt - st.now),
      priceUp: (a, b) => a.currentBid - b.currentBid,
      priceDown: (a, b) => b.currentBid - a.currentBid,
      bids: (a, b) => b.bids.length - a.bids.length,
    };
    list = [...list].sort(sortFns[st.sort] || sortFns.ending);

    // pagination: clamp the page in case the filtered list shrank below it
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const page = Math.min(st.page, totalPages);
    const pageStart = (page - 1) * PAGE_SIZE;
    const pageList = list.slice(pageStart, pageStart + PAGE_SIZE);

    const catOpts = ['Pokémon', 'Sports', 'Other'].map((v) => ({ label: v, value: v, active: fc.cats.includes(v), onClick: () => this.toggleCat(v) }));
    const rarityOpts: Array<[Rarity, string, string]> = [['common', 'Common', '#13c06a'], ['rare', 'Rare', '#2d5bff'], ['epic', 'Epic', '#7c3aed'], ['legendary', 'Legendary', '#e0a92e']];
    const priceOpts: Array<[string, string]> = [['any', 'Any price'], ['lt100', 'Under $100'], ['100to1k', '$100 – $1,000'], ['gt1k', '$1,000+']];
    const statusOpts: Array<{ key: 'ending' | 'buyNow' | 'graded'; label: string }> = [
      { key: 'ending', label: '⏱ Ending soon' }, { key: 'buyNow', label: '⚡ Buy Now available' }, { key: 'graded', label: '🛡 Graded only' },
    ];
    const sortOpts: Array<[string, string]> = [['ending', 'Ending soon'], ['priceUp', 'Price: low → high'], ['priceDown', 'Price: high → low'], ['bids', 'Most bids']];
    const activeCount = fc.cats.length + fc.rarities.length + (fc.graded ? 1 : 0) + (fc.buyNow ? 1 : 0) + (fc.ending ? 1 : 0) + (fc.price !== 'any' ? 1 : 0) + (query ? 1 : 0);

    // my bids / selling derived
    const statusMeta = (s: string) =>
      s === 'winning' ? { label: 'Winning', icon: '🏆', bg: '#bff3d4', col: '#0a5e34' }
        : s === 'outbid' ? { label: 'Outbid', icon: '⚡', bg: '#ffd1cc', col: '#a3160a' }
          : s === 'won' ? { label: 'Won', icon: '🎉', bg: INK, col: '#ffd84d' }
            : { label: 'Leading', icon: '•', bg: '#fff', col: INK };
    const involved = st.cards.filter((c) => st.myMax[c.id] != null || st.status[c.id] === 'won');
    const winningCount = involved.filter((c) => st.status[c.id] === 'winning').length;
    const outbidCount = involved.filter((c) => st.status[c.id] === 'outbid').length;
    const watchList = st.cards.filter((c) => st.watched[c.id]);
    const owned = st.cards.filter((c) => c.mine);
    const liveCount = owned.filter((c) => c.endsAt - st.now > 0).length;

    const sel = this.getCard(st.selectedId);

    const filterChip = (key: string, label: string, active: boolean, onClick: () => void, extra?: React.ReactNode) => (
      <div key={key} onClick={onClick} style={{ display: extra ? 'flex' : undefined, alignItems: 'center', gap: 9, fontSize: 12.5, fontWeight: 700, padding: '8px 12px', border: `2.5px solid ${INK}`, borderRadius: 9, cursor: 'pointer', ...this.chipStyle(active) }}>
        {extra}{label}
      </div>
    );

    return (
      <div style={{ minHeight: '100vh', background: '#fff7ec', fontFamily: SANS, color: INK }}>
        {/* ===== TOP NAV ===== */}
        <div style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', alignItems: 'center', gap: 18, padding: '14px 32px', background: '#ffd84d', borderBottom: `3px solid ${INK}` }}>
          <div onClick={this.goHome} style={{ display: 'flex', alignItems: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, letterSpacing: '-.03em', cursor: 'pointer' }}>
            <span>TOP<span style={{ color: '#ff4d3d' }}>DECK</span></span>
          </div>
          <div style={{ flex: 1, maxWidth: 460, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, padding: '9px 14px' }}>
            <span style={{ fontSize: 14, color: 'rgba(26,19,5,.45)' }}>⌕</span>
            <input
              value={st.query}
              onChange={this.setQuery}
              placeholder="Search 2.4M cards & collectibles…"
              aria-label="Search auctions"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: SANS, fontSize: 13.5, fontWeight: 500, color: INK }}
            />
            {st.query && (
              <span onClick={this.clearQuery} title="Clear search" style={{ cursor: 'pointer', fontSize: 13, fontWeight: 800, color: 'rgba(26,19,5,.45)', padding: '0 2px' }}>✕</span>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <div onClick={this.goHome} style={{ cursor: 'pointer' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: st.screen === 'mybids' ? 'rgba(26,19,5,.55)' : INK, paddingBottom: 2, borderBottom: st.screen === 'mybids' ? '2.5px solid transparent' : `2.5px solid ${INK}` }}>Auctions</div>
          </div>
          <div onClick={this.goMyBids} style={{ cursor: 'pointer' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: st.screen === 'mybids' ? INK : 'rgba(26,19,5,.55)', paddingBottom: 2, borderBottom: st.screen === 'mybids' ? `2.5px solid ${INK}` : '2.5px solid transparent' }}>My bids</div>
          </div>
          <div onClick={this.goSell} style={{ fontSize: 13, fontWeight: 700, padding: '9px 16px', background: '#2d5bff', color: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer' }}>Sell a card</div>
          {wallet.passkeyAvailable && !wallet.address && (
            <div onClick={() => { if (!wallet.connecting) void wallet.connectViaPasskey(); }} title="Create or connect a passkey smart wallet — no seed phrase" style={{ fontSize: 12.5, fontWeight: 800, padding: '8px 13px', background: INK, color: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer' }}>⚡ Face ID</div>
          )}
          <div style={{ position: 'relative' }}>
            <div onClick={this.onWalletClick} title={wallet.address ? 'Manage wallet' : 'Connect wallet'} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 800, padding: '8px 13px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: wallet.address ? '#13c06a' : 'rgba(26,19,5,.3)' }} />
              {wallet.connecting ? 'Connecting…' : wallet.address ? `${wallet.walletKind === 'passkey' ? '⚡ ' : ''}${shorten(wallet.address)}` : 'Connect'}
              {wallet.address && <span style={{ fontSize: 9, marginLeft: -2, transform: st.walletMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>}
            </div>
            {wallet.address && st.walletMenuOpen && this.renderWalletMenu(wallet.address)}
          </div>
        </div>

        {/* ===== BROWSE ===== */}
        {st.screen === 'browse' && (
          <div style={{ maxWidth: 1180, margin: '0 auto', padding: '30px 32px 80px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 8 }}>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#ff4d3d', letterSpacing: '.04em', marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d3d', animation: 'pulseDot 1.3s infinite' }} />LIVE AUCTIONS
                </div>
                <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', margin: 0, lineHeight: 1 }}>Bid, win, collect.</h1>
                <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 8, fontWeight: 500 }}>{list.length} cards under the hammer · new lots every hour</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'rgba(26,19,5,.55)' }}>{list.length} of {st.cards.length} lots</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '236px 1fr', gap: 28, marginTop: 26, alignItems: 'start' }}>
              {/* filter sidebar */}
              <div style={{ position: 'sticky', top: 88, background: '#fff', border: `3px solid ${INK}`, borderRadius: 16, boxShadow: `5px 5px 0 ${INK}`, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 16px', background: '#ffd84d', borderBottom: `3px solid ${INK}` }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>Filters</div>
                  {activeCount > 0 && (
                    <div onClick={this.clearFilters} style={{ fontSize: 11.5, fontWeight: 800, padding: '5px 11px', background: INK, color: '#fff', borderRadius: 7, cursor: 'pointer' }}>Clear {activeCount}</div>
                  )}
                </div>
                <div style={{ padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>CATEGORY</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      {catOpts.map((o) => (
                        <div key={o.value} onClick={o.onClick} style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', border: `2.5px solid ${INK}`, borderRadius: 999, cursor: 'pointer', ...this.chipStyle(o.active) }}>{o.label}</div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>RARITY</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {rarityOpts.map(([v, label, dot]) => filterChip(v, label, fc.rarities.includes(v), () => this.toggleRarity(v),
                        <span key="d" style={{ width: 11, height: 11, borderRadius: '50%', background: dot, border: `2px solid ${INK}`, flex: 'none' }} />))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>PRICE</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {priceOpts.map(([v, label]) => filterChip(v, label, fc.price === v, () => this.setPrice(v)))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>STATUS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {statusOpts.map((o) => filterChip(o.key, o.label, fc[o.key], () => this.toggleFlag(o.key)))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: 'rgba(26,19,5,.5)', marginBottom: 9 }}>SORT BY</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {sortOpts.map(([v, label]) => filterChip(v, label, st.sort === v, () => this.setSort(v)))}
                    </div>
                  </div>
                </div>
              </div>

              {/* grid */}
              <div>
                {list.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 24px', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16 }}>
                    <div style={{ fontSize: 42 }}>🔍</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 21, marginTop: 10 }}>{query ? `No lots match “${st.query.trim()}”` : 'No lots match those filters'}</div>
                    <div style={{ fontSize: 13.5, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 6 }}>{query ? 'Try a different search or clear it.' : 'Try loosening a filter or two.'}</div>
                    <div onClick={this.clearFilters} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '12px 22px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>{query ? 'Clear search & filters' : 'Clear filters'}</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
                      {pageList.map((c) => this.cardTile(c, 172))}
                    </div>
                    {totalPages > 1 && this.renderPagination(page, totalPages, list.length, pageStart, pageList.length)}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== DETAIL ===== */}
        {st.screen === 'detail' && sel && this.renderDetail(sel)}

        {/* ===== MY BIDS ===== */}
        {st.screen === 'mybids' && (
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 32px 90px' }}>
            <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 36, letterSpacing: '-.02em', margin: 0 }}>My bids</h1>
            <div style={{ fontSize: 14, color: 'rgba(26,19,5,.55)', marginTop: 6, fontWeight: 500 }}>Every lot you&apos;re chasing — and everything you&apos;re selling.</div>

            <div style={{ display: 'inline-flex', border: `3px solid ${INK}`, borderRadius: 11, overflow: 'hidden', margin: '20px 0 24px', boxShadow: `3px 3px 0 ${INK}` }}>
              <div onClick={() => this.setMyBidsTab('bidding')} style={{ fontSize: 13.5, fontWeight: 800, padding: '11px 24px', cursor: 'pointer', background: st.myBidsTab === 'bidding' ? INK : '#fff', color: st.myBidsTab === 'bidding' ? '#fff' : INK, borderRight: `3px solid ${INK}` }}>Bidding</div>
              <div onClick={() => this.setMyBidsTab('selling')} style={{ fontSize: 13.5, fontWeight: 800, padding: '11px 24px', cursor: 'pointer', background: st.myBidsTab === 'selling' ? INK : '#fff', color: st.myBidsTab === 'selling' ? '#fff' : INK }}>Selling</div>
            </div>

            {st.myBidsTab === 'bidding' && this.renderBidding(involved, watchList, winningCount, outbidCount, statusMeta)}
            {st.myBidsTab === 'selling' && this.renderSelling(owned, liveCount)}
          </div>
        )}

        {/* ===== SELL ===== */}
        {st.screen === 'sell' && this.renderSell()}

        {/* ===== BID MODAL ===== */}
        {st.bidOpen && sel && this.renderBidModal(sel)}

        {/* ===== TOAST ===== */}
        {st.toast && (
          <div style={{ position: 'fixed', left: '50%', bottom: 30, transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 11, padding: '14px 22px', background: st.toastKind === 'outbid' ? '#ff4d3d' : '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 13, boxShadow: `4px 4px 0 ${INK}`, fontWeight: 700, fontSize: 14, animation: 'modalIn .25s ease both' }}>
            <span style={{ fontSize: 18 }}>{st.toastKind === 'outbid' ? '⚡' : '✓'}</span>{st.toast}
          </div>
        )}
      </div>
    );
  }

  // ===== DETAIL =====
  /**
   * Pay-with-any-asset picker: choose the source asset and, for a non-USDC
   * choice, show a live Stellar path-payment quote — what the buyer spends, the
   * slippage-capped maximum, and the USDC the seller still receives. Selecting
   * USDC is the no-conversion default.
   */
  private renderPayWith(c: TopCard) {
    const st = this.state;
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
                onClick={() => this.selectPayAsset(a.id)}
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

  /**
   * The on-chain settlement breakdown for this listing: the sale price splits
   * atomically into seller proceeds, a 2% platform fee, and — on resale of a
   * card with a registered royalty — a creator royalty. Surfaced here in the
   * payment flow since the auction skin has no separate trade-history table.
   */
  private renderSettlement(c: TopCard) {
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

  private renderDetail(c: TopCard) {
    const st = this.state;
    const rm = rarityMeta(c.rarity);
    const left = c.endsAt - st.now;
    const ending = left < 3600000;
    const min = c.currentBid + increment(c.currentBid);
    const status = st.status[c.id];
    const banner =
      status === 'winning' ? { t: "🏆 You're the top bidder — hold tight!", bg: '#bff3d4', col: '#0a5e34' }
        : status === 'outbid' ? { t: "⚡ You've been outbid — raise your bid to win", bg: '#ffd1cc', col: '#a3160a' }
          : status === 'won' ? { t: '🎉 Purchased — heading to the TopDeck Vault', bg: '#bff3d4', col: '#0a5e34' }
            : null;
    const watched = st.watched[c.id];
    const bids = c.bids.map((b, i) => ({
      ...b,
      when: b.at ? fmtAgo(st.now - b.at) : fmtAgo(b.ago ?? 0),
      dot: b.you ? '#13c06a' : i === 0 ? '#ff4d3d' : 'rgba(26,19,5,.25)',
      nameColor: b.you ? '#13c06a' : INK,
      rowBg: b.you ? '#f0fff6' : i === 0 ? '#fff7ec' : '#fff',
    }));

    return (
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 32px 90px' }}>
        <div onClick={this.goHome} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 20, padding: '7px 14px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}` }}>← All auctions</div>

        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 40, alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 90 }}>
            <div style={{ position: 'relative', aspectRatio: '3 / 4', borderRadius: 18, border: `3px solid ${INK}`, boxShadow: `7px 7px 0 ${INK}`, background: c.art, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 14, left: 14, fontSize: 12, fontWeight: 800, letterSpacing: '.03em', padding: '5px 13px', borderRadius: 8, background: rm.bg, color: rm.color, border: `2px solid ${INK}` }}>{rm.label}</div>
              <div onClick={(e) => this.toggleWatch(e, c.id)} style={{ position: 'absolute', top: 13, right: 13, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: watched ? '#ff4d3d' : '#fff', border: `2.5px solid ${INK}`, fontSize: 18, color: watched ? '#fff' : 'rgba(26,19,5,.35)', cursor: 'pointer' }}>♥</div>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, background: 'linear-gradient(transparent,rgba(26,19,5,.55))', color: '#fff', fontWeight: 700, fontSize: 13 }}>{c.grade}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              {['🔍 Zoom', '📋 Card info', '↗ Share'].map((t) => (
                <div key={t} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 700, padding: 9, background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9 }}>{t}</div>
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
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 700, padding: '11px 15px', borderRadius: 11, border: `2.5px solid ${INK}`, background: banner.bg, color: banner.col }}>{banner.t}</div>
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
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, padding: '6px 14px', borderRadius: 10, border: `2.5px solid ${INK}`, marginTop: 5, background: ending ? '#ff4d3d' : INK, color: '#fff' }}>⏱ {fmtLeft(left)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <div onClick={this.openBid} style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 800, padding: 15, background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer', fontFamily: DISPLAY }}>Place bid</div>
                {c.buyNow > 0 && (
                  <div onClick={this.buyNow} style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 800, padding: 15, background: '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer', fontFamily: DISPLAY }}>Buy now · {money(c.buyNow)}</div>
                )}
              </div>
              {this.props.wallet.passkeyAvailable && c.real && c.contractListingId != null && (
                <>
                  <div
                    onClick={this.state.paying ? undefined : this.payWithPasskey}
                    style={{ marginTop: 12, textAlign: 'center', fontSize: 15, fontWeight: 800, padding: 15, background: this.state.paying ? 'rgba(26,19,5,.35)' : INK, color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: this.state.paying ? 'default' : 'pointer', fontFamily: DISPLAY }}
                  >
                    {this.state.paying ? 'Confirming…' : `⚡ Pay with Face ID · ${money(c.buyNow > 0 ? c.buyNow : c.currentBid)}`}
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'rgba(26,19,5,.5)', marginTop: 7 }}>
                    {this.state.payErr ?? 'No seed phrase · no extension · fees sponsored'}
                  </div>
                </>
              )}
              <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.45)', marginTop: 12 }}>🛡 Buyer protection · authenticated by TopDeck Vault before shipping</div>
            </div>

            {c.buyNow > 0 && this.renderPayWith(c)}
            {this.renderSettlement(c)}

            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 18, padding: '14px 16px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 13 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: c.sellerArt, border: `2.5px solid ${INK}` }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{c.seller}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>★ {c.sellerRating} · {c.sellerSales} sales</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', border: `2.5px solid ${INK}`, borderRadius: 9, cursor: 'pointer' }}>View store</div>
            </div>

            <div style={{ marginTop: 24 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Bid history</div>
              <div style={{ background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 13, overflow: 'hidden' }}>
                {bids.length === 0 && <div style={{ padding: '16px', fontSize: 13, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>No bids yet — be the first.</div>}
                {bids.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1.5px solid rgba(26,19,5,.1)', background: b.rowBg }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: b.dot }} />
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: b.nameColor }}>{b.bidder}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(26,19,5,.45)' }}>{b.when}</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, minWidth: 80, textAlign: 'right' }}>{money(b.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== MY BIDS: BIDDING =====
  private renderBidding(
    involved: TopCard[],
    watchList: TopCard[],
    winningCount: number,
    outbidCount: number,
    statusMeta: (s: string) => { label: string; icon: string; bg: string; col: string },
  ) {
    const st = this.state;
    const chip = (n: number | string, label: string, bg: string, col: string) => (
      <div style={{ flex: 1, minWidth: 150, background: bg, border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: col }}>{n}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: col === INK ? 'rgba(26,19,5,.55)' : col, marginTop: 4 }}>{label}</div>
      </div>
    );
    return (
      <>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '22px 0 28px' }}>
          {chip(involved.length, 'Active lots', '#fff', INK)}
          {chip(winningCount, '🏆 Winning', '#bff3d4', '#0a5e34')}
          {chip(outbidCount, '⚡ Outbid', '#ffd1cc', '#a3160a')}
          {chip(watchList.length, '♥ Watching', '#ffd84d', INK)}
        </div>

        {involved.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {involved.map((c) => {
              const rm = rarityMeta(c.rarity);
              const left = c.endsAt - st.now;
              const ending = left < 3600000;
              const stt = st.status[c.id] || 'winning';
              const sm = statusMeta(stt);
              const isOutbid = stt === 'outbid';
              const myMax = st.myMax[c.id];
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '14px 16px' }}>
                  <div onClick={() => this.open(c.id)} style={{ position: 'relative', width: 80, height: 80, flex: 'none', borderRadius: 11, border: `2.5px solid ${INK}`, background: c.art, cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', bottom: 5, left: 5, fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 5, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div onClick={() => this.open(c.id)} style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>{c.name}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 7, border: `2px solid ${INK}`, marginTop: 7, background: sm.bg, color: sm.col }}>{sm.icon} {sm.label}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 80 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Your max</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{myMax != null ? money(myMax) : '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 90 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Current bid</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{money(c.currentBid)}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 78 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Ends in</div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: ending ? '#ff4d3d' : 'rgba(26,19,5,.55)' }}>⏱ {fmtLeft(left)}</div>
                  </div>
                  <div onClick={() => (isOutbid ? this.openBidFor(c.id) : this.open(c.id))} style={{ flex: 'none', textAlign: 'center', fontSize: 13, fontWeight: 800, padding: '11px 16px', border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer', background: isOutbid ? '#ff4d3d' : '#fff', color: isOutbid ? '#fff' : INK }}>{isOutbid ? 'Bid again' : 'View lot'}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '54px 24px', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16 }}>
            <div style={{ fontSize: 42 }}>🎴</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, marginTop: 10 }}>No bids yet</div>
            <div style={{ fontSize: 13.5, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 6 }}>Find a card you love and place your first bid.</div>
            <div onClick={this.goHome} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '13px 24px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>Browse auctions</div>
          </div>
        )}

        {watchList.length > 0 && (
          <>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, margin: '36px 0 16px' }}>♥ Watchlist</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
              {watchList.map((c) => this.cardTile(c, 150))}
            </div>
          </>
        )}
      </>
    );
  }

  // ===== MY BIDS: SELLING =====
  private renderSelling(owned: TopCard[], liveCount: number) {
    const st = this.state;
    return (
      <>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 26 }}>
          <div style={{ flex: 1, minWidth: 150, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1 }}>{owned.length}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 4 }}>Listings</div>
          </div>
          <div style={{ flex: 1, minWidth: 150, background: '#bff3d4', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: '#0a5e34' }}>{liveCount}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0a5e34', marginTop: 4 }}>● Live now</div>
          </div>
          <div onClick={this.goSell} style={{ flex: 1, minWidth: 150, background: '#ffd84d', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '16px 18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, lineHeight: 1.1 }}>+ List a card</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,19,5,.55)', marginTop: 4 }}>Start an auction</div>
          </div>
        </div>

        {owned.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {owned.map((c) => {
              const rm = rarityMeta(c.rarity);
              const left = c.endsAt - st.now;
              const live = left > 0;
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, padding: '14px 16px' }}>
                  <div onClick={() => this.open(c.id)} style={{ position: 'relative', width: 80, height: 80, flex: 'none', borderRadius: 11, border: `2.5px solid ${INK}`, background: c.art, cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', bottom: 5, left: 5, fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 5, background: rm.bg, color: rm.color, border: `1.5px solid ${INK}` }}>{rm.label}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div onClick={() => this.open(c.id)} style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>{c.name}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 7, border: `2px solid ${INK}`, marginTop: 7, background: live ? '#bff3d4' : '#e7ddc8', color: live ? '#0a5e34' : 'rgba(26,19,5,.55)' }}>{live ? '● Live' : 'Ended'}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 84 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Top bid</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{money(c.currentBid)}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 64 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Bids</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>{c.bids.length}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 78 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>Ends in</div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>⏱ {fmtLeft(left)}</div>
                  </div>
                  <div onClick={() => this.open(c.id)} style={{ flex: 'none', textAlign: 'center', fontSize: 13, fontWeight: 800, padding: '11px 16px', border: `2.5px solid ${INK}`, borderRadius: 10, boxShadow: `2px 2px 0 ${INK}`, cursor: 'pointer', background: '#fff' }}>View listing</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '54px 24px', background: '#fff', border: `3px dashed ${INK}`, borderRadius: 16 }}>
            <div style={{ fontSize: 42 }}>🔨</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, marginTop: 10 }}>You&apos;re not selling anything yet</div>
            <div style={{ fontSize: 13.5, color: 'rgba(26,19,5,.55)', fontWeight: 500, marginTop: 6 }}>Turn your spare cards into cash — auctions take two minutes to set up.</div>
            <div onClick={this.goSell} style={{ display: 'inline-block', marginTop: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, padding: '13px 24px', background: '#13c06a', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>List a card</div>
          </div>
        )}
      </>
    );
  }

  // ===== SELL =====
  private renderSell() {
    const st = this.state;
    const f = st.form;
    const rm = rarityMeta(f.rarity);
    const startN = Number(f.startBid) || 0;
    const buyN = Number(f.buyNow) || 0;
    const durLabel = f.duration === 1 ? '1 day' : f.duration + ' days';
    // Hold mode needs a selected card; mint mode needs a name + photo to issue one.
    const step1Valid = st.sellMode === 'mint' ? f.title.trim().length > 0 && !!f.image : !!f.cardId;
    const step2Valid = startN > 0 && (!f.buyNowOn || buyN > startN) && (!f.graded || (f.grade || '').trim().length > 0);
    const previewArt = f.image ? `center/cover no-repeat url("${f.image}")` : rarityArt(f.rarity);
    const chip = (active: boolean, label: string, onClick: () => void) => (
      <div key={label} onClick={onClick} style={{ fontSize: 13, fontWeight: 700, padding: '10px 18px', border: `2.5px solid ${INK}`, borderRadius: 999, cursor: 'pointer', ...this.chipStyle(active) }}>{label}</div>
    );
    const inputStyle: CSSProperties = { width: '100%', fontFamily: SANS, fontSize: 15, fontWeight: 600, padding: '13px 15px', border: `3px solid ${INK}`, borderRadius: 11, outline: 'none', background: '#fff', color: INK };

    if (st.sellStep === 4) {
      return (
        <div style={{ maxWidth: 1060, margin: '0 auto', padding: '24px 32px 90px' }}>
          <div style={{ maxWidth: 520, margin: '30px auto 0', textAlign: 'center' }}>
            <div style={{ fontSize: 56 }}>🎉</div>
            <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, letterSpacing: '-.02em', margin: '10px 0 0' }}>Your auction is live!</h1>
            <div style={{ fontSize: 14.5, color: 'rgba(26,19,5,.6)', fontWeight: 500, marginTop: 8 }}>Listed on-chain — the card is locked in escrow until it sells or you cancel.</div>
            {st.lastHash && (
              <a href={this.props.explorerTx(st.lastHash)} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 700, color: '#2d5bff' }}>View transaction ↗</a>
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
              <div onClick={this.goHome} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 26px', background: '#ff4d3d', color: '#fff', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: 'pointer' }}>View in marketplace</div>
              <div onClick={this.listAnother} style={{ fontWeight: 800, fontSize: 15, padding: '14px 24px', background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer' }}>List another</div>
            </div>
          </div>
        </div>
      );
    }

    const stepDot = (n: number) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', border: `2.5px solid ${INK}`, background: st.sellStep >= n ? '#ff4d3d' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: st.sellStep >= n && n === 1 ? '#fff' : INK }}>{n}</div>
        <span style={{ fontSize: 13, fontWeight: 700, color: st.sellStep >= n ? INK : 'rgba(26,19,5,.4)' }}>{['Details', 'Pricing', 'Review'][n - 1]}</span>
      </div>
    );

    return (
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '24px 32px 90px' }}>
        <div onClick={this.goHome} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 18, padding: '7px 14px', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 9, boxShadow: `2px 2px 0 ${INK}` }}>← Cancel</div>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, letterSpacing: '-.02em', margin: 0 }}>List a card for auction</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 26px' }}>
          {stepDot(1)}
          <div style={{ flex: 'none', width: 30, height: 2.5, background: INK }} />
          {stepDot(2)}
          <div style={{ flex: 'none', width: 30, height: 2.5, background: INK }} />
          {stepDot(3)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 40, alignItems: 'start' }}>
          <div>
            {/* STEP 1 — pick a real card */}
            {st.sellStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* mode: list a held card vs. mint a brand-new one */}
                <div style={{ display: 'inline-flex', border: `3px solid ${INK}`, borderRadius: 11, overflow: 'hidden', boxShadow: `3px 3px 0 ${INK}` }}>
                  <div onClick={() => this.setSellMode('hold')} style={{ fontSize: 13, fontWeight: 800, padding: '10px 18px', cursor: 'pointer', background: st.sellMode === 'hold' ? INK : '#fff', color: st.sellMode === 'hold' ? '#fff' : INK, borderRight: `3px solid ${INK}` }}>A card I hold</div>
                  <div onClick={() => this.setSellMode('mint')} style={{ fontSize: 13, fontWeight: 800, padding: '10px 18px', cursor: 'pointer', background: st.sellMode === 'mint' ? INK : '#fff', color: st.sellMode === 'mint' ? '#fff' : INK }}>✨ Mint a new card</div>
                </div>
                {st.sellMode === 'hold' ? (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>CHOOSE A CARD YOU HOLD</div>
                    {this.props.catalog.length === 0 ? (
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', background: '#fff', border: `2px dashed ${INK}`, borderRadius: 11, padding: '13px 15px' }}>
                        {!this.props.wallet.address
                          ? 'Connect your wallet to see the cards you hold.'
                          : 'You don’t hold any cards yet. Switch to “Mint a new card” to issue one.'}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                        {this.props.catalog.map((cat) => {
                          const active = f.cardId === cat.id;
                          return (
                            <div key={cat.id} onClick={() => this.selectCatalogCard(cat)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 10, background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 11, cursor: 'pointer', boxShadow: active ? `3px 3px 0 ${INK}` : 'none' }}>
                              <div style={{ width: 44, height: 44, flex: 'none', borderRadius: 8, border: `2px solid ${INK}`, background: cat.imageUrl ? `center/cover no-repeat url("${cat.imageUrl}")` : rarityArt(mapRarity(cat.rarity)) }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cat.name}</div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>{cat.set} · {cat.rarity}</div>
                              </div>
                              {active && <span style={{ fontSize: 15, color: '#13c06a', fontWeight: 800 }}>✓</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.62)', background: '#fff', border: `2px dashed ${INK}`, borderRadius: 11, padding: '13px 15px' }}>
                    You&apos;re issuing a brand-new card on-chain. Fill in its details below — it&apos;s minted to your wallet when you publish, then listed for sale.
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>CARD NAME</div>
                  <input value={f.title} onChange={(e) => this.setForm('title', e.target.value)} placeholder="e.g. Solar Drake · 1st Edition" style={inputStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>SET &amp; NUMBER</div>
                  <input value={f.setLine} onChange={(e) => this.setForm('setLine', e.target.value)} placeholder="e.g. Base Set · #006 / 102" style={inputStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>CARD PHOTO</div>
                  <div
                    onClick={() => this.fileInput?.click()}
                    onDragOver={(e) => { e.preventDefault(); if (!st.dragOver) this.setState({ dragOver: true }); }}
                    onDragLeave={() => this.setState({ dragOver: false })}
                    onDrop={this.onDropImage}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: st.dragOver ? '#fff7e6' : '#fff', border: `2.5px dashed ${INK}`, borderRadius: 11, cursor: 'pointer', boxShadow: st.dragOver ? `3px 3px 0 ${INK}` : 'none' }}
                  >
                    <div style={{ width: 46, height: 46, flex: 'none', borderRadius: 8, border: `2px solid ${INK}`, background: previewArt }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{f.image ? 'Photo added — click to replace' : 'Upload your own photo'}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>Drag &amp; drop or <span style={{ color: '#2d5bff', textDecoration: 'underline' }}>browse files</span> · PNG/JPG up to 8&nbsp;MB</div>
                    </div>
                    {f.image && (
                      <span onClick={(e) => { e.stopPropagation(); this.setForm('image', undefined); }} style={{ fontSize: 12, fontWeight: 800, color: '#ff4d3d', flex: 'none' }}>Remove</span>
                    )}
                  </div>
                  <input ref={(el) => { this.fileInput = el; }} type="file" accept="image/*" onChange={this.onPickImage} style={{ display: 'none' }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>CATEGORY</div>
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                    {['Pokémon', 'Sports', 'Other'].map((v) => chip(f.category === v, v, () => this.setForm('category', v)))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>RARITY</div>
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                    {(['common', 'rare', 'epic', 'legendary'] as Rarity[]).map((v) => chip(f.rarity === v, v.charAt(0).toUpperCase() + v.slice(1), () => this.setForm('rarity', v)))}
                  </div>
                </div>
                {st.sellMode === 'mint' && (
                  <>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>SUPPLY (COPIES TO ISSUE)</div>
                      <input type="number" min={1} max={1000} value={f.supply} onChange={(e) => this.setForm('supply', e.target.value)} style={{ ...inputStyle, width: 140 }} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em' }}>CREATOR ROYALTY</span>
                        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 }}>{(Number(f.royaltyPct) || 0).toFixed(1)}%</span>
                      </div>
                      <input type="range" min={0} max={10} step={0.5} value={Number(f.royaltyPct) || 0} onChange={(e) => this.setForm('royaltyPct', e.target.value)} style={{ width: '100%', accentColor: '#ff4d3d' }} />
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
                    <div onClick={() => this.setForm('graded', true)} style={{ fontSize: 13, fontWeight: 800, padding: '11px 22px', cursor: 'pointer', background: f.graded ? '#ffd84d' : '#fff', borderRight: `2.5px solid ${INK}` }}>Graded slab</div>
                    <div onClick={() => this.setForm('graded', false)} style={{ fontSize: 13, fontWeight: 800, padding: '11px 22px', cursor: 'pointer', background: !f.graded ? '#ffd84d' : '#fff' }}>Raw card</div>
                  </div>
                  {f.graded ? (
                    <input value={f.grade} onChange={(e) => this.setForm('grade', e.target.value)} placeholder="e.g. PSA 10, BGS 9.5" style={{ ...inputStyle, marginTop: 12, width: 240 }} />
                  ) : (
                    <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 12 }}>
                      {['Mint', 'Near Mint', 'Lightly Played', 'Played'].map((v) => chip(f.condition === v, v, () => this.setForm('condition', v)))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>STARTING BID (USDC)</div>
                  <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 11, padding: '2px 15px', width: 240 }}>
                    <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>$</span>
                    <input type="number" value={f.startBid} onChange={(e) => this.setForm('startBid', e.target.value)} placeholder="0" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, padding: '11px 6px', width: '100%', color: INK }} />
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 6 }}>This is the listing price locked into the settlement contract.</div>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 300 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em' }}>BUY IT NOW</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', marginTop: 2 }}>Cosmetic preview — fixed-price sale settles at the listed price</div>
                    </div>
                    <div onClick={() => this.setForm('buyNowOn', !f.buyNowOn)} style={{ width: 46, height: 28, borderRadius: 999, border: `2.5px solid ${INK}`, background: f.buyNowOn ? '#13c06a' : '#fff', position: 'relative', cursor: 'pointer', flex: 'none' }}>
                      <div style={{ position: 'absolute', top: 1, left: f.buyNowOn ? 18 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', border: `2px solid ${INK}`, transition: 'left .15s' }} />
                    </div>
                  </div>
                  {f.buyNowOn && (
                    <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 11, padding: '2px 15px', width: 240, marginTop: 12 }}>
                      <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>$</span>
                      <input type="number" value={f.buyNow} onChange={(e) => this.setForm('buyNow', e.target.value)} placeholder="0" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, padding: '11px 6px', width: '100%', color: INK }} />
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.02em', marginBottom: 8 }}>AUCTION LENGTH</div>
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                    {([[1, '1 day'], [3, '3 days'], [7, '7 days']] as Array<[number, string]>).map(([v, l]) => chip(f.duration === v, l, () => this.setForm('duration', v)))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 — review */}
            {st.sellStep === 3 && (
              <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `4px 4px 0 ${INK}`, overflow: 'hidden' }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, padding: '15px 18px', borderBottom: `2.5px solid ${INK}`, background: '#ffd84d' }}>Review your listing</div>
                <div style={{ padding: '6px 18px 12px' }}>
                  {([['Card', f.title || 'Untitled card'], ['Set', f.setLine || '—'], ['Condition', f.graded ? `${f.grade} · Graded` : f.condition], ['Starting bid', money(startN)], ['Buy it now', f.buyNowOn && buyN > 0 ? money(buyN) : 'None'], ['Runs for', durLabel]] as Array<[string, string]>).map(([k, v], i, arr) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderBottom: i === arr.length - 1 ? 'none' : '1.5px solid rgba(26,19,5,.1)' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(26,19,5,.55)' }}>{k}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(26,19,5,.5)', padding: '12px 18px', background: '#fff7ec', borderTop: `2.5px solid ${INK}` }}>🛡 Your card ships to the TopDeck Vault for authentication before payout. Listing locks one copy in the settlement contract.</div>
              </div>
            )}

            {/* nav buttons */}
            <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
              {st.sellStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div onClick={() => step1Valid && this.sellNext()} title={step1Valid ? undefined : st.sellMode === 'mint' ? 'Name your card and add a photo to continue' : 'Pick a card you hold above to continue'} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 28px', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: step1Valid ? 'pointer' : 'not-allowed', background: step1Valid ? '#ff4d3d' : '#e7ddc8', color: step1Valid ? '#fff' : 'rgba(26,19,5,.4)' }}>Continue to pricing →</div>
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
                  <div onClick={this.sellBack} style={{ fontWeight: 800, fontSize: 15, padding: '14px 22px', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer', background: '#fff' }}>← Back</div>
                  <div onClick={() => step2Valid && this.sellNext()} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 28px', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: step2Valid ? 'pointer' : 'default', background: step2Valid ? '#ff4d3d' : '#e7ddc8', color: step2Valid ? '#fff' : 'rgba(26,19,5,.4)' }}>Review listing →</div>
                </>
              )}
              {st.sellStep === 3 && (
                <>
                  <div onClick={this.sellBack} style={{ fontWeight: 800, fontSize: 15, padding: '14px 22px', border: `3px solid ${INK}`, borderRadius: 12, cursor: 'pointer', background: '#fff' }}>← Back</div>
                  <div onClick={() => !st.publishing && this.publishListing()} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, padding: '14px 30px', border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `3px 3px 0 ${INK}`, cursor: st.publishing ? 'default' : 'pointer', background: '#13c06a', color: '#fff', opacity: st.publishing ? 0.7 : 1 }}>{st.publishing ? (st.sellMode === 'mint' && !st.mintedCard ? 'Minting…' : 'Publishing…') : st.sellMode === 'mint' ? '✨ Mint & publish' : '🔨 Publish auction'}</div>
                </>
              )}
            </div>
          </div>

          {/* live preview */}
          <div style={{ position: 'sticky', top: 90 }}>
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
                  <div style={{ fontSize: 11, fontWeight: 800, padding: '4px 9px', borderRadius: 7, background: INK, color: '#fff' }}>⏱ {durLabel}</div>
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

  // ===== BID MODAL =====
  private renderBidModal(c: TopCard) {
    const st = this.state;
    const inc = increment(c.currentBid);
    const min = c.currentBid + inc;
    const amt = Number(st.bidAmount);
    const valid = amt >= min;
    const quickBids = [min, min + inc, min + 4 * inc];
    return (
      <div onClick={this.closeBid} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(26,19,5,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'overlayIn .15s ease both' }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#fff7ec', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `8px 8px 0 ${INK}`, padding: 24, animation: 'modalIn .22s cubic-bezier(.2,.9,.3,1.3) both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 21 }}>Place your bid</div>
            <div onClick={this.closeBid} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `2.5px solid ${INK}`, background: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>✕</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(26,19,5,.55)', marginBottom: 18 }}>{c.name} · current bid {money(c.currentBid)}</div>

          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(26,19,5,.5)', marginBottom: 7 }}>YOUR MAX BID</div>
          <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `3px solid ${INK}`, borderRadius: 12, padding: '4px 16px' }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26 }}>$</span>
            <input type="number" value={st.bidAmount} onChange={this.onBidInput} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, color: INK, padding: '10px 6px', width: '100%' }} />
          </div>

          <div style={{ display: 'flex', gap: 9, marginTop: 12 }}>
            {quickBids.map((q, i) => (
              <div key={q} onClick={() => this.setBid(q)} style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700, padding: 11, border: `2.5px solid ${INK}`, borderRadius: 10, background: i === 0 ? '#ffd84d' : '#fff', color: INK, cursor: 'pointer' }}>{money(q)}</div>
            ))}
          </div>

          {st.bidAmount !== '' && !valid && (
            <div style={{ marginTop: 13, fontSize: 12.5, fontWeight: 700, color: '#ff4d3d' }}>Enter at least {money(min)}</div>
          )}

          <div onClick={this.confirmBid} style={{ marginTop: 18, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, padding: 16, border: `3px solid ${INK}`, borderRadius: 13, cursor: valid ? 'pointer' : 'default', background: valid ? '#ff4d3d' : '#e7ddc8', color: valid ? '#fff' : 'rgba(26,19,5,.4)', boxShadow: `3px 3px 0 ${INK}` }}>{valid ? `Confirm bid · ${money(amt)}` : 'Enter a higher bid'}</div>
          <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'rgba(26,19,5,.45)', marginTop: 11 }}>Bids are simulated in this demo. Listings &amp; wallet are live on Stellar testnet.</div>
        </div>
      </div>
    );
  }
}

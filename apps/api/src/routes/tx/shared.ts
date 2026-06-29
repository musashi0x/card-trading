import { MarketplaceContract, usdcAsset } from '@cardmkt/shared';
import { env } from '../../env.js';
import { PreflightError, requireTrustline, simulateContractView, type ViewRead } from '../../stellar.js';
import * as listingsRepo from '../../data/listings.js';
import * as offersRepo from '../../data/offers.js';

export const contract = new MarketplaceContract(env.contractId);
export const usdc = usdcAsset(env.usdc.code, env.usdc.issuer);

export function notFound(what: string): never {
  throw new PreflightError(`${what} not found`, 'NOT_FOUND');
}

export function needContractId(value: number | null, what: string): number {
  if (value == null) {
    throw new PreflightError(`${what} is not yet confirmed on-chain`, 'NOT_CONFIRMED');
  }
  return value;
}

/**
 * Classify an entity's on-chain open-state from its read-only view, so a build
 * route never asks a user to sign against a drifted Postgres mirror. `gone` means
 * the contract has no such entry (a stale id from a prior deploy, or an archived
 * entry); `{ closed }` carries the contract's non-open status code. An
 * unverifiable RPC read is treated as `open` (tolerate the transient hiccup — the
 * contract stays the final, atomic guard).
 */
export function classifyOpen(view: ViewRead): 'open' | 'gone' | { closed: number } {
  if (view.kind === 'missing') return 'gone';
  if (view.kind === 'ok' && Number(view.value.status ?? 0) !== 0) {
    return { closed: Number(view.value.status) };
  }
  return 'open';
}

/**
 * Confirm a listing is still open on-chain before a buyer locks funds against it
 * (`buy_now`/`purchase_escrow`/`make_offer`). On a definitive mismatch, sync the
 * row's status so it stops being offered and surface a clean error instead of a
 * cryptic contract `NotFound`/`NotOpen` trap.
 */
export async function requireOnChainOpenListing(listingId: string, cid: number): Promise<void> {
  const state = classifyOpen(await simulateContractView(contract.getListingView(cid)));
  if (state === 'open') return;
  if (state === 'gone') {
    await listingsRepo.markCancelled(listingId);
    throw new PreflightError('This listing is no longer available', 'LISTING_UNAVAILABLE');
  }
  // Mirrors the contract's STATUS_* codes: 1 = sold, 2 = cancelled.
  await (state.closed === 1 ? listingsRepo.markSold(listingId) : listingsRepo.markCancelled(listingId));
  throw new PreflightError('This listing is no longer open', 'LISTING_CLOSED');
}

/**
 * Confirm an offer is still open on-chain before the seller signs `accept_offer`,
 * which would otherwise trap if the offer was withdrawn or settled via another
 * path. Syncs the row to the on-chain terminal status on drift.
 */
export async function requireOnChainOpenOffer(offerId: string, oid: number): Promise<void> {
  const state = classifyOpen(await simulateContractView(contract.getOfferView(oid)));
  if (state === 'open') return;
  // OFFER_STATUS codes: 1 = settled, 2 = withdrawn; a gone entry is treated as withdrawn.
  if (state !== 'gone' && state.closed === 1) {
    await offersRepo.markSettled(offerId);
  } else {
    await offersRepo.markWithdrawn(offerId);
  }
  throw new PreflightError('This offer is no longer open', 'OFFER_CLOSED');
}

/**
 * Confirm an auction is still open on-chain before a bidder escrows USDC into
 * `place_bid`. The periodic indexer retires the row with the correct terminal
 * status (it holds the settle hash); here we only block the doomed bid.
 */
export async function requireOnChainOpenAuction(aid: number): Promise<void> {
  const state = classifyOpen(await simulateContractView(contract.getAuctionView(aid)));
  if (state !== 'open') {
    throw new PreflightError('This auction is no longer open', 'AUCTION_CLOSED');
  }
}

/**
 * Confirm an escrow order is still active on-chain before a lifecycle action
 * (`mark_shipped`/`confirm_receipt`/`dispute`/`claim_timeout`/`resolve`). The
 * mirror may say `funded`/`shipped` while the order has already released or
 * refunded on-chain, which would trap the action. An unverifiable RPC read is
 * tolerated (the contract stays the final guard).
 */
export async function requireOnChainActiveOrder(oid: number): Promise<void> {
  const view = await simulateContractView(contract.getOrderView(oid));
  if (view.kind === 'unknown') return;
  // ORDER_* codes: 3 = released, 4 = refunded (terminal); a gone entry is terminal too.
  if (view.kind === 'missing' || Number(view.value.status ?? 0) >= 3) {
    throw new PreflightError('This order is already settled', 'ORDER_CLOSED');
  }
}

/**
 * Confirm a swap proposal is still open (`proposed`) on-chain before an
 * accept/decline/cancel, which would otherwise trap if the proposal was already
 * executed, cancelled, or declined via another path. Tolerant of a transient RPC
 * read.
 */
export async function requireOnChainProposedSwap(sid: number): Promise<void> {
  const view = await simulateContractView(contract.getSwapView(sid));
  if (view.kind === 'unknown') return;
  // SWAP_PROPOSED = 10; anything else (accepted/cancelled/declined) or gone is terminal.
  if (view.kind === 'missing' || Number(view.value.status ?? 0) !== 10) {
    throw new PreflightError('This trade proposal is no longer active', 'SWAP_CLOSED');
  }
}

/**
 * When a settlement will pay a creator royalty, ensure the creator can receive
 * USDC — otherwise the atomic settlement would revert on-chain. No-op for cards
 * without a royalty or for primary sales (seller is the creator).
 */
export async function requireCreatorTrustline(
  card: { royaltyBps: number; creatorAccount: string | null },
  seller: string,
): Promise<void> {
  if (card.royaltyBps > 0 && card.creatorAccount && card.creatorAccount !== seller) {
    await requireTrustline(card.creatorAccount, usdc);
  }
}

import type { TradeAction } from '@cardmkt/shared';
import * as listings from '../data/listings.js';
import * as offers from '../data/offers.js';
import * as orders from '../data/orders.js';
import * as trades from '../data/trades.js';
import * as auctions from '../data/auctions.js';

export interface ReconcileCtx {
  refId: string;        // listing/offer/order row id created at build time
  hash: string;         // settlement tx hash
  returnValue: unknown; // parsed contract return (e.g. new contract id)
  actor: string;        // buyer/seller of record (G… signer source OR C… address)
}

const reconcilers: Record<TradeAction, (c: ReconcileCtx) => Promise<void>> = {
  list: async (c) => {
    const contractListingId = c.returnValue == null ? null : Number(c.returnValue);
    await listings.setContractListingId(
      c.refId,
      Number.isFinite(contractListingId) ? contractListingId : null,
      c.hash,
    );
  },
  make_offer: async (c) => {
    const contractOfferId = c.returnValue == null ? null : Number(c.returnValue);
    await offers.setContractOfferId(
      c.refId,
      Number.isFinite(contractOfferId) ? contractOfferId : null,
      c.hash,
    );
  },
  cancel_listing: async (c) => {
    await listings.markCancelled(c.refId);
  },
  withdraw_offer: async (c) => {
    await offers.markWithdrawn(c.refId);
  },
  accept_offer: async (c) => {
    const offerRow = await offers.offerLookup(c.refId);
    if (offerRow) {
      const row = await listings.listingWithCard(offerRow.listingId);
      await offers.markSettled(c.refId);
      await listings.markSold(offerRow.listingId);
      if (row) {
        await trades.recordTrade(row, {
          buyer: offerRow.buyer,
          hash: c.hash,
          priceUsdc: offerRow.amountUsdc,
        });
      }
    }
  },
  buy_now: async (c) => {
    const row = await listings.listingWithCard(c.refId);
    if (row) {
      await listings.markSold(c.refId);
      await trades.recordTrade(row, {
        buyer: c.actor,
        hash: c.hash,
      });
    }
  },
  purchase_escrow: async (c) => {
    const orderRow = await orders.orderWithListingCard(c.refId);
    const contractOrderId = c.returnValue == null ? null : Number(c.returnValue);
    await orders.setContractOrderId(
      c.refId,
      Number.isFinite(contractOrderId) ? contractOrderId : null,
      c.hash,
    );
    await listings.markSold(orderRow.order.listingId);
  },
  mark_shipped: async (c) => {
    await orders.markShipped(c.refId);
  },
  dispute: async (c) => {
    await orders.markDisputed(c.refId);
  },
  confirm_receipt: async (c) => {
    const { order, card } = await orders.orderWithListingCard(c.refId);
    if (order.status !== 'released') {
      await orders.markReleased(c.refId, c.hash);
      await trades.recordOrderTrade(order, card, c.hash);
    }
  },
  claim_timeout: async (c) => {
    const { order, card } = await orders.orderWithListingCard(c.refId);
    if (order.status !== 'released') {
      await orders.markReleased(c.refId, c.hash);
      await trades.recordOrderTrade(order, card, c.hash);
    }
  },
  create_auction: async (c) => {
    const contractAuctionId = c.returnValue == null ? null : Number(c.returnValue);
    await auctions.setContractAuctionId(
      c.refId,
      Number.isFinite(contractAuctionId) ? contractAuctionId : null,
      c.hash,
    );
  },
  place_bid: async (c) => {
    // refId is the bid row id created at build time.
    await auctions.applyBid(c.refId, c.hash);
  },
  settle_auction: async (c) => {
    const { auction, card } = await auctions.auctionWithCard(c.refId);
    if (auction.status !== 'open') return;
    const reserveMet =
      auction.highBidder != null &&
      Number(auction.highBidUsdc) >= Number(auction.reservePriceUsdc);
    if (reserveMet) {
      await auctions.markSettled(c.refId, c.hash);
      await trades.recordAuctionTrade(auction, card, c.hash);
    } else {
      await auctions.markClosed(c.refId, 'no_winner', c.hash);
    }
  },
  cancel_auction: async (c) => {
    await auctions.markClosed(c.refId, 'cancelled', c.hash);
  },
  claim_refund: async () => {
    // Safety-valve withdrawal; no read-mirror state to reconcile.
  },
};

export async function reconcile(action: TradeAction, ctx: ReconcileCtx): Promise<void> {
  const handler = reconcilers[action];
  if (!handler) {
    throw new Error(`No reconciler found for action: ${action}`);
  }
  await handler(ctx);
}

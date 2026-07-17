import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import {
  FULFILLMENT,
  acceptOfferSchema,
  buyNowSchema,
  cancelAuctionSchema,
  cancelListingSchema,
  createAuctionSchema,
  placeBidSchema,
  settleAuctionSchema,
  fromStellarAsset,
  listInputSchema,
  makeOfferSchema,
  orderActionSchema,
  pathPaymentBuildSchema,
  pathQuoteSchema,
  purchaseEscrowSchema,
  toStellarAsset,
  toStroops,
  withdrawOfferSchema,
  type PathQuoteResponse,
} from '@cardmkt/shared';
import { env } from '../../env.js';
import {
  PreflightError,
  buildChangeTrustTx,
  buildContractTx,
  buildPathPaymentTx,
  findStrictReceivePath,
  getAssetBalance,
  hasTrustline,
  requireBalance,
  requireSourceBalance,
  requireTrustline,
  withSlippage,
} from '../../stellar.js';
import * as listingsRepo from '../../data/listings.js';
import * as ordersRepo from '../../data/orders.js';
import * as auctionsRepo from '../../data/auctions.js';
import * as cardCopiesRepo from '../../data/card-copies.js';
import {
  contract,
  usdc,
  notFound,
  needContractId,
  requireCopyOwnership,
  requireCreatorTrustline,
  requireOnChainOpenListing,
  requireOnChainOpenOffer,
  requireOnChainOpenAuction,
  requireOnChainActiveOrder,
} from './shared.js';

export const buildRouter: Router = Router();

const { listings, offers, orders } = schema;

/**
 * Like {@link requireBalance} for USDC, but when the account has no USDC trustline
 * at all, attach a ready-to-sign `change_trust` XDR to the `MISSING_TRUSTLINE`
 * error so the client can establish the trustline and retry in one flow — the same
 * self-healing recovery the convert (path-payment) build offers. Once a trustline
 * exists, the regular balance check applies (an `INSUFFICIENT_BALANCE` with funds
 * too low carries no recovery XDR, since signing a trustline would not help).
 */
async function requireUsdcBalance(account: string, amount: string): Promise<void> {
  if (!(await hasTrustline(account, usdc))) {
    const xdr = await buildChangeTrustTx(account, usdc);
    throw new PreflightError(
      `Account must establish a trustline to ${usdc.getCode()} first`,
      'MISSING_TRUSTLINE',
      {
        assetCode: usdc.getCode(),
        assetIssuer: usdc.getIssuer(),
        xdr,
        networkPassphrase: env.stellar.networkPassphrase,
      },
    );
  }
  await requireBalance(account, usdc, amount);
}

// --- build: list ---
buildRouter.post('/list', async (req, res, next) => {
  try {
    const input = listInputSchema.parse(req.body);
    const row = await cardCopiesRepo.copyWithCard(input.cardCopyId);
    if (!row) notFound('Card copy');
    const { copy, card } = row;
    // Seller must actually own this specific copy on-chain.
    await requireCopyOwnership(input.seller, copy.tokenId);

    const op = contract.list(
      input.seller,
      copy.tokenId,
      toStroops(input.priceUsdc),
      FULFILLMENT[input.fulfillment],
    );
    const xdr = await buildContractTx(input.seller, op);

    const [listing] = await db
      .insert(listings)
      .values({
        cardId: card.id,
        cardCopyId: copy.id,
        seller: input.seller,
        priceUsdc: input.priceUsdc,
        status: 'open',
        fulfillment: input.fulfillment,
      })
      .returning();

    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: listing!.id });
  } catch (err) {
    next(err);
  }
});

// --- build: cancel_listing ---
buildRouter.post('/cancel', async (req, res, next) => {
  try {
    const input = cancelListingSchema.parse(req.body);
    const { listing } = await listingsRepo.listingWithCard(input.listingId);
    const cid = needContractId(listing.contractListingId, 'Listing');
    await requireOnChainOpenListing(listing.id, cid);
    const op = contract.cancelListing(input.seller, cid);
    const xdr = await buildContractTx(input.seller, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: listing.id });
  } catch (err) {
    next(err);
  }
});

// --- build: make_offer ---
buildRouter.post('/make-offer', async (req, res, next) => {
  try {
    const input = makeOfferSchema.parse(req.body);
    const { listing } = await listingsRepo.listingWithCard(input.listingId);
    const cid = needContractId(listing.contractListingId, 'Listing');
    await requireOnChainOpenListing(listing.id, cid);
    // Buyer needs USDC to escrow now. NFT ownership needs no trustline, so
    // settlement can deliver the card to the buyer unconditionally.
    await requireUsdcBalance(input.buyer, input.amountUsdc);

    const op = contract.makeOffer(input.buyer, cid, toStroops(input.amountUsdc));
    const xdr = await buildContractTx(input.buyer, op);

    const [offer] = await db
      .insert(offers)
      .values({
        listingId: listing.id,
        buyer: input.buyer,
        amountUsdc: input.amountUsdc,
        status: 'open',
      })
      .returning();

    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: offer!.id });
  } catch (err) {
    next(err);
  }
});

// --- build: withdraw_offer ---
buildRouter.post('/withdraw-offer', async (req, res, next) => {
  try {
    const input = withdrawOfferSchema.parse(req.body);
    const [offer] = await db.select().from(offers).where(eq(offers.id, input.offerId));
    if (!offer) notFound('Offer');
    const oid = needContractId(offer.contractOfferId, 'Offer');
    await requireOnChainOpenOffer(offer.id, oid);
    const op = contract.withdrawOffer(input.buyer, oid);
    const xdr = await buildContractTx(input.buyer, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: offer.id });
  } catch (err) {
    next(err);
  }
});

// --- build: accept_offer ---
buildRouter.post('/accept-offer', async (req, res, next) => {
  try {
    const input = acceptOfferSchema.parse(req.body);
    const [offer] = await db.select().from(offers).where(eq(offers.id, input.offerId));
    if (!offer) notFound('Offer');
    const oid = needContractId(offer.contractOfferId, 'Offer');
    await requireOnChainOpenOffer(offer.id, oid);
    // If a royalty will be paid, the creator must be able to receive the USDC.
    const { card } = await listingsRepo.listingWithCard(offer.listingId);
    await requireCreatorTrustline(card, input.seller);
    const op = contract.acceptOffer(input.seller, oid);
    const xdr = await buildContractTx(input.seller, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: offer.id });
  } catch (err) {
    next(err);
  }
});

// --- build: buy_now ---
buildRouter.post('/buy-now', async (req, res, next) => {
  try {
    const input = buyNowSchema.parse(req.body);
    const { listing, card } = await listingsRepo.requireOpenListing(input.listingId);
    const cid = needContractId(listing.contractListingId, 'Listing');
    await requireOnChainOpenListing(listing.id, cid);
    await requireUsdcBalance(input.buyer, listing.priceUsdc);
    // If a royalty will be paid, the creator must be able to receive the USDC.
    await requireCreatorTrustline(card, listing.seller);

    const op = contract.buyNow(input.buyer, cid);
    const xdr = await buildContractTx(input.buyer, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: listing.id });
  } catch (err) {
    next(err);
  }
});

// --- build: purchase_escrow (buyer locks USDC against a physical listing) ---
buildRouter.post('/purchase-escrow', async (req, res, next) => {
  try {
    const input = purchaseEscrowSchema.parse(req.body);
    const { listing, card } = await listingsRepo.requireOpenListing(input.listingId);
    const cid = needContractId(listing.contractListingId, 'Listing');
    if (listing.fulfillment !== 'physical') {
      throw new PreflightError('Listing is not a physical (escrow) listing', 'WRONG_FULFILLMENT');
    }
    await requireOnChainOpenListing(listing.id, cid);
    // Drop any abandoned funded rows (signed but never submitted) so a stale
    // pre-insert from a cancelled checkout never blocks this listing.
    await ordersRepo.sweepAbandonedOrders();
    // Buyer needs the asking price in USDC; NFT ownership needs no trustline,
    // so the card can be delivered on release unconditionally. A royalty payee
    // must be able to receive USDC too.
    await requireUsdcBalance(input.buyer, listing.priceUsdc);
    await requireCreatorTrustline(card, listing.seller);

    const op = contract.purchaseEscrow(input.buyer, cid);
    const xdr = await buildContractTx(input.buyer, op);

    const [order] = await db
      .insert(orders)
      .values({
        listingId: listing.id,
        buyer: input.buyer,
        seller: listing.seller,
        amountUsdc: listing.priceUsdc,
        status: 'funded',
      })
      .returning();

    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: order!.id });
  } catch (err) {
    next(err);
  }
});

// --- build: mark_shipped (seller signals dispatch) ---
buildRouter.post('/mark-shipped', async (req, res, next) => {
  try {
    const input = orderActionSchema.parse(req.body);
    const trackingRef =
      typeof req.body.trackingRef === 'string' ? req.body.trackingRef.trim() : undefined;
    const { order } = await ordersRepo.orderWithListingCard(input.orderId);
    const oid = needContractId(order.contractOrderId, 'Order');
    await requireOnChainActiveOrder(oid);
    if (order.seller !== input.account) {
      throw new PreflightError('Only the seller can mark an order shipped', 'NOT_SELLER');
    }
    if (order.status !== 'funded') {
      throw new PreflightError(`Order cannot be shipped from status "${order.status}"`, 'BAD_STATE');
    }
    if (trackingRef) {
      await ordersRepo.updateTrackingRef(order.id, trackingRef);
    }
    const op = contract.markShipped(input.account, oid);
    const xdr = await buildContractTx(input.account, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: order.id });
  } catch (err) {
    next(err);
  }
});

// --- build: confirm_receipt (buyer releases funds to the seller) ---
buildRouter.post('/confirm-receipt', async (req, res, next) => {
  try {
    const input = orderActionSchema.parse(req.body);
    const { order } = await ordersRepo.orderWithListingCard(input.orderId);
    const oid = needContractId(order.contractOrderId, 'Order');
    await requireOnChainActiveOrder(oid);
    if (order.buyer !== input.account) {
      throw new PreflightError('Only the buyer can confirm receipt', 'NOT_BUYER');
    }
    if (order.status !== 'funded' && order.status !== 'shipped') {
      throw new PreflightError(`Order cannot be confirmed from status "${order.status}"`, 'BAD_STATE');
    }
    const op = contract.confirmReceipt(input.account, oid);
    const xdr = await buildContractTx(input.account, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: order.id });
  } catch (err) {
    next(err);
  }
});

// --- build: dispute (buyer or seller freezes the order for the arbiter) ---
buildRouter.post('/dispute', async (req, res, next) => {
  try {
    const input = orderActionSchema.parse(req.body);
    const { order } = await ordersRepo.orderWithListingCard(input.orderId);
    const oid = needContractId(order.contractOrderId, 'Order');
    await requireOnChainActiveOrder(oid);
    if (order.buyer !== input.account && order.seller !== input.account) {
      throw new PreflightError('Only the buyer or seller can dispute an order', 'NOT_PARTICIPANT');
    }
    if (order.status !== 'funded' && order.status !== 'shipped') {
      throw new PreflightError(`Order cannot be disputed from status "${order.status}"`, 'BAD_STATE');
    }
    const op = contract.dispute(input.account, oid);
    const xdr = await buildContractTx(input.account, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: order.id });
  } catch (err) {
    next(err);
  }
});

// --- build: claim_timeout (anyone releases to the seller after the window) ---
buildRouter.post('/claim-timeout', async (req, res, next) => {
  try {
    const input = orderActionSchema.parse(req.body);
    const { order } = await ordersRepo.orderWithListingCard(input.orderId);
    const oid = needContractId(order.contractOrderId, 'Order');
    await requireOnChainActiveOrder(oid);
    if (order.status !== 'funded' && order.status !== 'shipped') {
      throw new PreflightError(`Order cannot be timed out from status "${order.status}"`, 'BAD_STATE');
    }
    if (order.confirmDeadline && Date.now() / 1000 < order.confirmDeadline) {
      throw new PreflightError('Confirmation window has not elapsed yet', 'DEADLINE_NOT_REACHED', {
        confirmDeadline: order.confirmDeadline,
      });
    }
    // `claim_timeout` takes no signer; `account` is just the fee-paying source.
    const op = contract.claimTimeout(oid);
    const xdr = await buildContractTx(input.account, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: order.id });
  } catch (err) {
    next(err);
  }
});

// --- build: create_auction (seller escrows a card into a timed auction) ---
buildRouter.post('/create-auction', async (req, res, next) => {
  try {
    const input = createAuctionSchema.parse(req.body);
    const row = await cardCopiesRepo.copyWithCard(input.cardCopyId);
    if (!row) notFound('Card copy');
    const { copy, card } = row;
    const reserveUsdc = input.reservePriceUsdc ?? '0';
    if (Number(reserveUsdc) > 0 && Number(reserveUsdc) < Number(input.startPriceUsdc)) {
      throw new PreflightError('Reserve price must be at least the start price', 'BAD_RESERVE');
    }
    // Seller must actually own this specific copy to escrow it.
    await requireCopyOwnership(input.seller, copy.tokenId);

    const op = contract.createAuction(
      input.seller,
      copy.tokenId,
      toStroops(input.startPriceUsdc),
      toStroops(reserveUsdc),
      input.durationSecs,
    );
    const xdr = await buildContractTx(input.seller, op);

    const auction = await auctionsRepo.createAuctionRow({
      cardId: card.id,
      cardCopyId: copy.id,
      seller: input.seller,
      startPriceUsdc: input.startPriceUsdc,
      reservePriceUsdc: reserveUsdc,
      endsAt: new Date(Date.now() + input.durationSecs * 1000),
    });

    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: auction.id });
  } catch (err) {
    next(err);
  }
});

// --- build: place_bid (bidder escrows USDC against an open auction) ---
buildRouter.post('/place-bid', async (req, res, next) => {
  try {
    const input = placeBidSchema.parse(req.body);
    const { auction } = await auctionsRepo.auctionWithCard(input.auctionId);
    const cid = needContractId(auction.contractAuctionId, 'Auction');
    if (auction.status !== 'open') {
      throw new PreflightError('Auction is not open for bids', 'AUCTION_CLOSED');
    }
    // Bids close the instant the auction ends; the contract traps `AuctionExpired`.
    if (Date.now() >= new Date(auction.endsAt).getTime()) {
      throw new PreflightError('Auction has ended', 'AUCTION_EXPIRED');
    }
    // A seller cannot bid on their own auction (contract: `SelfTrade`).
    if (auction.seller === input.bidder) {
      throw new PreflightError('You cannot bid on your own auction', 'SELF_TRADE');
    }
    // Bid must beat the current high bid and meet the start price.
    if (
      Number(input.amountUsdc) <= Number(auction.highBidUsdc) ||
      Number(input.amountUsdc) < Number(auction.startPriceUsdc)
    ) {
      throw new PreflightError('Bid must exceed the current high bid', 'BID_TOO_LOW', {
        highBidUsdc: auction.highBidUsdc,
        startPriceUsdc: auction.startPriceUsdc,
      });
    }
    // The DB checks above are a fast pre-filter; confirm against the chain that the
    // auction is still open before the bidder escrows USDC into a doomed bid.
    await requireOnChainOpenAuction(cid);
    // Bidder needs the USDC to escrow now; NFT ownership needs no trustline, so
    // settlement can deliver the card unconditionally.
    await requireUsdcBalance(input.bidder, input.amountUsdc);

    const op = contract.placeBid(input.bidder, cid, toStroops(input.amountUsdc));
    const xdr = await buildContractTx(input.bidder, op);

    const bid = await auctionsRepo.createBidRow({
      auctionId: auction.id,
      bidder: input.bidder,
      amountUsdc: input.amountUsdc,
    });

    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: bid.id });
  } catch (err) {
    next(err);
  }
});

// --- build: settle_auction (permissionless once the auction has ended) ---
buildRouter.post('/settle-auction', async (req, res, next) => {
  try {
    const input = settleAuctionSchema.parse(req.body);
    const { auction, card } = await auctionsRepo.auctionWithCard(input.auctionId);
    const cid = needContractId(auction.contractAuctionId, 'Auction');
    if (auction.status !== 'open') {
      throw new PreflightError('Auction is already settled', 'AUCTION_CLOSED');
    }
    // Settlement is only valid once the auction has ended (contract: `AuctionLive`).
    if (Date.now() < new Date(auction.endsAt).getTime()) {
      throw new PreflightError('Auction is still live', 'AUCTION_LIVE');
    }
    // The mirror may lag a settle that already landed on-chain; confirm still open.
    await requireOnChainOpenAuction(cid);
    // If a royalty will be paid to the winner's settlement, the creator must be
    // able to receive the USDC.
    await requireCreatorTrustline(card, auction.seller);
    // `settle_auction` takes no signer; `account` is just the fee-paying source.
    const op = contract.settleAuction(cid);
    const xdr = await buildContractTx(input.account, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: auction.id });
  } catch (err) {
    next(err);
  }
});

// --- build: cancel_auction (seller reclaims a no-bid auction) ---
buildRouter.post('/cancel-auction', async (req, res, next) => {
  try {
    const input = cancelAuctionSchema.parse(req.body);
    const auction = await auctionsRepo.auctionLookup(input.auctionId);
    if (!auction) notFound('Auction');
    const cid = needContractId(auction.contractAuctionId, 'Auction');
    if (auction.status !== 'open') {
      throw new PreflightError('Auction is not open', 'AUCTION_CLOSED');
    }
    if (auction.seller !== input.seller) {
      throw new PreflightError('Only the seller can cancel an auction', 'NOT_SELLER');
    }
    if (Number(auction.highBidUsdc) > 0) {
      throw new PreflightError('Auction with bids cannot be cancelled', 'AUCTION_HAS_BIDS');
    }
    await requireOnChainOpenAuction(cid);
    const op = contract.cancelAuction(input.seller, cid);
    const xdr = await buildContractTx(input.seller, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: auction.id });
  } catch (err) {
    next(err);
  }
});

// --- build: quote a pay-with-any-asset conversion ---
buildRouter.post('/quote-path', async (req, res, next) => {
  try {
    const input = pathQuoteSchema.parse(req.body);
    const sourceAsset = toStellarAsset(input.sourceAsset);

    // Only convert the gap between what's needed and what the buyer already holds.
    const currentUsdc = await getAssetBalance(input.buyer, usdc);
    const shortfall = Math.max(0, Number(input.destUsdc) - Number(currentUsdc));

    const slippageBps = env.pathPaymentSlippageBps;
    if (shortfall <= 0) {
      // Already funded — signal "no conversion" with a zero quote.
      const quote: PathQuoteResponse = {
        sourceAsset: input.sourceAsset,
        destUsdc: '0',
        sendAmount: '0',
        sendMax: '0',
        slippageBps,
        path: [],
      };
      res.json(quote);
      return;
    }

    const destUsdc = shortfall.toFixed(7);
    const found = await findStrictReceivePath(sourceAsset, usdc, destUsdc);
    if (!found) {
      throw new PreflightError(
        `No path from ${input.sourceAsset.code} to ${usdc.getCode()} for ${destUsdc}`,
        'NO_PATH',
        { sourceAsset: input.sourceAsset, destUsdc },
      );
    }

    const quote: PathQuoteResponse = {
      sourceAsset: input.sourceAsset,
      destUsdc,
      sendAmount: found.sendAmount,
      sendMax: withSlippage(found.sendAmount, slippageBps),
      slippageBps,
      path: found.path.map(fromStellarAsset),
    };
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

// --- build: pay-with-any-asset path payment (top-up to USDC) ---
buildRouter.post('/path-payment', async (req, res, next) => {
  try {
    const input = pathPaymentBuildSchema.parse(req.body);
    const sourceAsset = toStellarAsset(input.sourceAsset);
    const path = input.path.map(toStellarAsset);

    if (!(await hasTrustline(input.buyer, usdc))) {
      const changeTrustXdr = await buildChangeTrustTx(input.buyer, usdc);
      throw new PreflightError(
        `Establish a ${usdc.getCode()} trustline before converting`,
        'MISSING_TRUSTLINE',
        {
          assetCode: usdc.getCode(),
          assetIssuer: usdc.getIssuer(),
          xdr: changeTrustXdr,
          networkPassphrase: env.stellar.networkPassphrase,
        },
      );
    }
    await requireSourceBalance(input.buyer, sourceAsset, input.sendMax);

    const xdr = await buildPathPaymentTx(
      input.buyer,
      sourceAsset,
      input.sendMax,
      usdc,
      input.destUsdc,
      path,
    );
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase });
  } catch (err) {
    next(err);
  }
});

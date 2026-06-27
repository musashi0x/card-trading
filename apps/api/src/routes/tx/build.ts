import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import {
  FULFILLMENT,
  acceptOfferSchema,
  buyNowSchema,
  cancelListingSchema,
  cardAsset,
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
  buildTrustlineTx,
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
import {
  contract,
  usdc,
  notFound,
  needContractId,
  requireCreatorTrustline,
} from './shared.js';

export const buildRouter: Router = Router();

const { cards, listings, offers, orders } = schema;

// --- build: list ---
buildRouter.post('/list', async (req, res, next) => {
  try {
    const input = listInputSchema.parse(req.body);
    const [card] = await db.select().from(cards).where(eq(cards.id, input.cardId));
    if (!card) notFound('Card');
    if (!card.sacAddress) {
      throw new PreflightError('Card asset contract not deployed', 'CARD_SAC_MISSING');
    }
    // Seller must actually hold a copy of the card.
    await requireBalance(input.seller, cardAsset(card.assetCode, card.issuer), '1');

    const op = contract.list(
      input.seller,
      card.sacAddress,
      toStroops(input.priceUsdc),
      FULFILLMENT[input.fulfillment],
    );
    const xdr = await buildContractTx(input.seller, op);

    const [listing] = await db
      .insert(listings)
      .values({
        cardId: card.id,
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
    const { listing, card } = await listingsRepo.listingWithCard(input.listingId);
    const cid = needContractId(listing.contractListingId, 'Listing');
    // Buyer needs USDC to escrow now, and a card trustline so settlement can deliver.
    await requireBalance(input.buyer, usdc, input.amountUsdc);
    await requireTrustline(input.buyer, cardAsset(card.assetCode, card.issuer));

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
    const { listing, card } = await listingsRepo.listingWithCard(input.listingId);
    const cid = needContractId(listing.contractListingId, 'Listing');
    await requireBalance(input.buyer, usdc, listing.priceUsdc);
    await requireTrustline(input.buyer, cardAsset(card.assetCode, card.issuer));
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
    const { listing, card } = await listingsRepo.listingWithCard(input.listingId);
    const cid = needContractId(listing.contractListingId, 'Listing');
    if (listing.fulfillment !== 'physical') {
      throw new PreflightError('Listing is not a physical (escrow) listing', 'WRONG_FULFILLMENT');
    }
    // Buyer needs the asking price in USDC and a card trustline so the card can
    // be delivered on release; a royalty payee must be able to receive USDC too.
    await requireBalance(input.buyer, usdc, listing.priceUsdc);
    await requireTrustline(input.buyer, cardAsset(card.assetCode, card.issuer));
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

// --- build: trustline (classic changeTrust so a buyer can receive a card) ---
buildRouter.post('/trustline', async (req, res, next) => {
  try {
    const account = String(req.body.account ?? '');
    const cardId = String(req.body.cardId ?? '');
    const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
    if (!card) notFound('Card');
    const xdr = await buildTrustlineTx(account, cardAsset(card.assetCode, card.issuer));
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: card.id });
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

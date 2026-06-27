import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';
import {
  submitTxSchema,
  passkeySubmitSchema,
  passkeyListSchema,
  passkeyOrderSchema,
} from '@cardmkt/shared';
import { PreflightError, requireSmartWalletCard, requireSmartWalletUsdc } from '../../stellar.js';
import { relaySubmitter } from '../../relay.js';
import * as settle from '../../settlement/settle.js';
import { reconcile } from '../../settlement/reconcile.js';
import * as listingsRepo from '../../data/listings.js';
import * as ordersRepo from '../../data/orders.js';
import { needContractId, notFound } from './shared.js';

export const passkeyRouter: Router = Router();

const { cards, listings, offers, orders } = schema;

// --- submit: passkey smart-wallet deployment (deploy-on-first-use), relay only ---
passkeyRouter.post('/passkey-deploy', async (req, res, next) => {
  try {
    const { signedXdr } = submitTxSchema.parse(req.body);
    const result = await relaySubmitter().submit(signedXdr);
    res.json({ hash: result.hash, successful: result.successful });
  } catch (err) {
    next(err);
  }
});

// --- submit: passkey smart-wallet (gasless relay) + reconcile DB ---
passkeyRouter.post('/passkey-submit', async (req, res, next) => {
  try {
    const input = passkeySubmitSchema.parse(req.body);
    const { listing } = await listingsRepo.listingWithCard(input.listingId);
    needContractId(listing.contractListingId, 'Listing');

    // Pre-flight the contract-account buyer's USDC (no classic trustline check;
    // tolerant of an undeployed wallet).
    const need = input.action === 'buy_now' ? listing.priceUsdc : input.amountUsdc;
    if (input.action === 'make_offer' && !need) {
      throw new PreflightError('amountUsdc is required for make_offer', 'BAD_REQUEST');
    }
    await requireSmartWalletUsdc(input.buyer, need!);

    let refId = listing.id;
    if (input.action === 'make_offer') {
      const [offer] = await db
        .insert(offers)
        .values({
          listingId: listing.id,
          buyer: input.buyer,
          amountUsdc: need!,
          status: 'open',
        })
        .returning();
      refId = offer!.id;
    }

    const result = await settle.relayed(input.signedXdr);
    await reconcile(input.action, {
      refId,
      hash: result.hash,
      returnValue: result.returnValue,
      actor: input.buyer,
    });

    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// --- submit: passkey smart-wallet listing (gasless relay) + reconcile DB ---
passkeyRouter.post('/passkey-list', async (req, res, next) => {
  try {
    const input = passkeyListSchema.parse(req.body);
    const [card] = await db.select().from(cards).where(eq(cards.id, input.cardId));
    if (!card) notFound('Card');
    if (!card.sacAddress) {
      throw new PreflightError('Card asset contract not deployed', 'CARD_SAC_MISSING');
    }
    await requireSmartWalletCard(input.seller, card.sacAddress);

    const [listing] = await db
      .insert(listings)
      .values({
        cardId: card.id,
        seller: input.seller,
        priceUsdc: input.priceUsdc,
        status: 'open',
      })
      .returning();

    const result = await settle.relayed(input.signedXdr);
    await reconcile('list', {
      refId: listing!.id,
      hash: result.hash,
      returnValue: result.returnValue,
      actor: input.seller,
    });

    res.json({ hash: result.hash, successful: true, refId: listing!.id });
  } catch (err) {
    next(err);
  }
});

// --- submit: passkey smart-wallet escrow order action (gasless relay) + reconcile ---
passkeyRouter.post('/passkey-order', async (req, res, next) => {
  try {
    const input = passkeyOrderSchema.parse(req.body);

    if (input.action === 'purchase_escrow') {
      if (!input.listingId) {
        throw new PreflightError('listingId is required for purchase_escrow', 'BAD_REQUEST');
      }
      const { listing } = await listingsRepo.listingWithCard(input.listingId);
      needContractId(listing.contractListingId, 'Listing');
      if (listing.fulfillment !== 'physical') {
        throw new PreflightError('Listing is not a physical (escrow) listing', 'WRONG_FULFILLMENT');
      }
      await requireSmartWalletUsdc(input.account, listing.priceUsdc);

      const [order] = await db
        .insert(orders)
        .values({
          listingId: listing.id,
          buyer: input.account,
          seller: listing.seller,
          amountUsdc: listing.priceUsdc,
          status: 'funded',
        })
        .returning();

      const result = await settle.relayed(input.signedXdr);
      await reconcile('purchase_escrow', {
        refId: order!.id,
        hash: result.hash,
        returnValue: result.returnValue,
        actor: input.account,
      });

      res.json({ hash: result.hash, successful: true, refId: order!.id });
      return;
    }

    // Existing-order actions.
    if (!input.orderId) {
      throw new PreflightError('orderId is required for this action', 'BAD_REQUEST');
    }
    const { order } = await ordersRepo.orderWithListingCard(input.orderId);
    needContractId(order.contractOrderId, 'Order');

    const result = await settle.relayed(input.signedXdr);
    await reconcile(input.action, {
      refId: order.id,
      hash: result.hash,
      returnValue: result.returnValue,
      actor: input.account,
    });

    res.json({ hash: result.hash, successful: true, refId: order.id });
  } catch (err) {
    next(err);
  }
});

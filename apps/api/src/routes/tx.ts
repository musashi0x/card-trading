/**
 * Transaction build + submit (tasks 5.2–5.4).
 *
 * Build endpoints return unsigned XDR for the wallet to sign (no key custody),
 * after Horizon pre-flight checks. The submit endpoint relays the signed XDR,
 * derives the on-chain ids/actor from the result, and reconciles the DB rows.
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { db, schema } from '@cardmkt/db';
import {
  FULFILLMENT,
  MarketplaceContract,
  acceptOfferSchema,
  buyNowSchema,
  cancelListingSchema,
  cardAsset,
  fromStellarAsset,
  listInputSchema,
  makeOfferSchema,
  orderActionSchema,
  passkeyListSchema,
  passkeyOrderSchema,
  passkeySubmitSchema,
  pathPaymentBuildSchema,
  pathQuoteSchema,
  purchaseEscrowSchema,
  resolveOrderSchema,
  submitTxSchema,
  toStellarAsset,
  toStroops,
  usdcAsset,
  withdrawOfferSchema,
  type PathQuoteResponse,
  type TradeAction,
} from '@cardmkt/shared';
import { env } from '../env.js';
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
  requireSmartWalletCard,
  requireSmartWalletUsdc,
  requireSourceBalance,
  requireTrustline,
  signAndSubmitAs,
  submitClassicTx,
  submitSignedTx,
  transactionReturnValue,
  withSlippage,
} from '../stellar.js';
import { relaySubmitter } from '../relay.js';

export const txRouter: Router = Router();

const contract = new MarketplaceContract(env.contractId);
const usdc = usdcAsset(env.usdc.code, env.usdc.issuer);
const { cards, listings, offers, orders, trades } = schema;

function notFound(what: string): never {
  throw new PreflightError(`${what} not found`, 'NOT_FOUND');
}

function needContractId(value: number | null, what: string): number {
  if (value == null) {
    throw new PreflightError(`${what} is not yet confirmed on-chain`, 'NOT_CONFIRMED');
  }
  return value;
}

async function getListingWithCard(listingId: string) {
  const [row] = await db
    .select({ listing: listings, card: cards })
    .from(listings)
    .innerJoin(cards, eq(listings.cardId, cards.id))
    .where(eq(listings.id, listingId));
  if (!row) notFound('Listing');
  return row;
}

/**
 * When a settlement will pay a creator royalty, ensure the creator can receive
 * USDC — otherwise the atomic settlement would revert on-chain. No-op for cards
 * without a royalty or for primary sales (seller is the creator).
 */
async function requireCreatorTrustline(
  card: { royaltyBps: number; creatorAccount: string | null },
  seller: string,
): Promise<void> {
  if (card.royaltyBps > 0 && card.creatorAccount && card.creatorAccount !== seller) {
    await requireTrustline(card.creatorAccount, usdc);
  }
}

// --- build: list ---
txRouter.post('/list', async (req, res, next) => {
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
txRouter.post('/cancel', async (req, res, next) => {
  try {
    const input = cancelListingSchema.parse(req.body);
    const { listing } = await getListingWithCard(input.listingId);
    const cid = needContractId(listing.contractListingId, 'Listing');
    const op = contract.cancelListing(input.seller, cid);
    const xdr = await buildContractTx(input.seller, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: listing.id });
  } catch (err) {
    next(err);
  }
});

// --- build: make_offer ---
txRouter.post('/make-offer', async (req, res, next) => {
  try {
    const input = makeOfferSchema.parse(req.body);
    const { listing, card } = await getListingWithCard(input.listingId);
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
txRouter.post('/withdraw-offer', async (req, res, next) => {
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
txRouter.post('/accept-offer', async (req, res, next) => {
  try {
    const input = acceptOfferSchema.parse(req.body);
    const [offer] = await db.select().from(offers).where(eq(offers.id, input.offerId));
    if (!offer) notFound('Offer');
    const oid = needContractId(offer.contractOfferId, 'Offer');
    // If a royalty will be paid, the creator must be able to receive the USDC.
    const { card } = await getListingWithCard(offer.listingId);
    await requireCreatorTrustline(card, input.seller);
    const op = contract.acceptOffer(input.seller, oid);
    const xdr = await buildContractTx(input.seller, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: offer.id });
  } catch (err) {
    next(err);
  }
});

// --- build: buy_now ---
txRouter.post('/buy-now', async (req, res, next) => {
  try {
    const input = buyNowSchema.parse(req.body);
    const { listing, card } = await getListingWithCard(input.listingId);
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

// --- physical escrow: order helpers ---

async function getOrderWithListingCard(orderId: string) {
  const [row] = await db
    .select({ order: orders, listing: listings, card: cards })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .innerJoin(cards, eq(listings.cardId, cards.id))
    .where(eq(orders.id, orderId));
  if (!row) notFound('Order');
  return row;
}

/** Record the settlement of a released escrow order as a trade row. */
async function recordOrderTrade(
  order: { listingId: string; buyer: string; seller: string; amountUsdc: string },
  card: { royaltyBps: number; creatorAccount: string | null },
  hash: string,
): Promise<void> {
  await db.insert(trades).values({
    listingId: order.listingId,
    buyer: order.buyer,
    seller: order.seller,
    priceUsdc: order.amountUsdc,
    feeUsdc: feeFor(order.amountUsdc),
    royaltyUsdc: royaltyFor(order.amountUsdc, card, order.seller),
    settleTxHash: hash,
  });
}

// --- build: purchase_escrow (buyer locks USDC against a physical listing) ---
txRouter.post('/purchase-escrow', async (req, res, next) => {
  try {
    const input = purchaseEscrowSchema.parse(req.body);
    const { listing, card } = await getListingWithCard(input.listingId);
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
txRouter.post('/mark-shipped', async (req, res, next) => {
  try {
    const input = orderActionSchema.parse(req.body);
    const trackingRef =
      typeof req.body.trackingRef === 'string' ? req.body.trackingRef.trim() : undefined;
    const { order } = await getOrderWithListingCard(input.orderId);
    const oid = needContractId(order.contractOrderId, 'Order');
    if (order.seller !== input.account) {
      throw new PreflightError('Only the seller can mark an order shipped', 'NOT_SELLER');
    }
    if (order.status !== 'funded') {
      throw new PreflightError(`Order cannot be shipped from status "${order.status}"`, 'BAD_STATE');
    }
    if (trackingRef) {
      await db.update(orders).set({ trackingRef }).where(eq(orders.id, order.id));
    }
    const op = contract.markShipped(input.account, oid);
    const xdr = await buildContractTx(input.account, op);
    res.json({ xdr, networkPassphrase: env.stellar.networkPassphrase, refId: order.id });
  } catch (err) {
    next(err);
  }
});

// --- build: confirm_receipt (buyer releases funds to the seller) ---
txRouter.post('/confirm-receipt', async (req, res, next) => {
  try {
    const input = orderActionSchema.parse(req.body);
    const { order } = await getOrderWithListingCard(input.orderId);
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
txRouter.post('/dispute', async (req, res, next) => {
  try {
    const input = orderActionSchema.parse(req.body);
    const { order } = await getOrderWithListingCard(input.orderId);
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
txRouter.post('/claim-timeout', async (req, res, next) => {
  try {
    const input = orderActionSchema.parse(req.body);
    const { order } = await getOrderWithListingCard(input.orderId);
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

// --- resolve: arbiter settles a disputed order (server-signed) ---
//
// The arbiter is a separate key from the admin; the API holds it and signs
// `resolve` directly (an arbitration-dashboard action), so this both submits and
// reconciles. Returns 501 when no arbiter key is configured.
txRouter.post('/resolve', async (req, res, next) => {
  try {
    const input = resolveOrderSchema.parse(req.body);
    if (!env.arbiterSecret) {
      const e = new PreflightError('Arbitration is not configured on this server', 'NO_ARBITER');
      e.status = 501;
      throw e;
    }
    const { order, card } = await getOrderWithListingCard(input.orderId);
    const oid = needContractId(order.contractOrderId, 'Order');
    if (order.status !== 'disputed') {
      throw new PreflightError('Only a disputed order can be resolved', 'BAD_STATE', {
        status: order.status,
      });
    }

    const result = await signAndSubmitAs(env.arbiterSecret, contract.resolve(oid, input.refund));
    if (!result.successful) {
      throw new PreflightError('Resolution did not succeed on-chain', 'TX_FAILED', {
        hash: result.hash,
      });
    }

    if (input.refund) {
      await db
        .update(orders)
        .set({ status: 'refunded', settleTxHash: result.hash })
        .where(eq(orders.id, order.id));
    } else {
      await db
        .update(orders)
        .set({ status: 'released', settleTxHash: result.hash })
        .where(eq(orders.id, order.id));
      await recordOrderTrade(order, card, result.hash);
    }

    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// --- build: trustline (classic changeTrust so a buyer can receive a card) ---
txRouter.post('/trustline', async (req, res, next) => {
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
// Prices a source-asset -> USDC route and sizes the conversion to the buyer's
// USDC shortfall, so a buyer already holding enough USDC converts nothing.
txRouter.post('/quote-path', async (req, res, next) => {
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
// Pre-flight: a missing USDC trustline returns MISSING_TRUSTLINE plus a
// change_trust build to run first; an insufficient source balance is rejected.
txRouter.post('/path-payment', async (req, res, next) => {
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

// --- submit: classic tx (trustline), no contract reconciliation ---
txRouter.post('/submit-classic', async (req, res, next) => {
  try {
    const { signedXdr } = submitTxSchema.parse(req.body);
    const hash = await submitClassicTx(signedXdr);
    res.json({ hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// --- submit: relay signed XDR + reconcile DB ---
function feeFor(amount: string): string {
  return ((Number(amount) * env.feeBps) / 10_000).toFixed(7);
}

/**
 * Creator royalty for a settlement, mirroring the contract: none on a primary
 * sale (seller is the creator) or for a card without a registered royalty.
 */
function royaltyFor(
  amount: string,
  card: { royaltyBps: number; creatorAccount: string | null },
  seller: string,
): string {
  if (!card.royaltyBps || !card.creatorAccount || card.creatorAccount === seller) {
    return '0.0000000';
  }
  return ((Number(amount) * card.royaltyBps) / 10_000).toFixed(7);
}

txRouter.post('/submit', async (req, res, next) => {
  try {
    const { signedXdr } = submitTxSchema.parse(req.body);
    const action = req.body.action as TradeAction;
    const refId = req.body.refId as string;

    const result = await submitSignedTx(signedXdr);
    if (!result.successful) {
      throw new PreflightError('Transaction did not succeed on-chain', 'TX_FAILED', {
        hash: result.hash,
      });
    }
    const tx = TransactionBuilder.fromXDR(signedXdr, env.stellar.networkPassphrase);
    const source = 'source' in tx ? tx.source : tx.innerTransaction.source;

    switch (action) {
      case 'list':
        await db
          .update(listings)
          .set({ contractListingId: Number(result.returnValue), escrowTxHash: result.hash })
          .where(eq(listings.id, refId));
        break;
      case 'make_offer':
        await db
          .update(offers)
          .set({ contractOfferId: Number(result.returnValue), escrowTxHash: result.hash })
          .where(eq(offers.id, refId));
        break;
      case 'cancel_listing':
        await db.update(listings).set({ status: 'cancelled' }).where(eq(listings.id, refId));
        break;
      case 'withdraw_offer':
        await db.update(offers).set({ status: 'withdrawn' }).where(eq(offers.id, refId));
        break;
      case 'accept_offer': {
        const [offer] = await db.select().from(offers).where(eq(offers.id, refId));
        if (offer) {
          const [row] = await db
            .select({ listing: listings, card: cards })
            .from(listings)
            .innerJoin(cards, eq(listings.cardId, cards.id))
            .where(eq(listings.id, offer.listingId));
          await db.update(offers).set({ status: 'settled' }).where(eq(offers.id, refId));
          await db.update(listings).set({ status: 'sold' }).where(eq(listings.id, offer.listingId));
          if (row) {
            await db.insert(trades).values({
              listingId: row.listing.id,
              buyer: offer.buyer,
              seller: row.listing.seller,
              priceUsdc: offer.amountUsdc,
              feeUsdc: feeFor(offer.amountUsdc),
              royaltyUsdc: royaltyFor(offer.amountUsdc, row.card, row.listing.seller),
              settleTxHash: result.hash,
            });
          }
        }
        break;
      }
      case 'buy_now': {
        const [row] = await db
          .select({ listing: listings, card: cards })
          .from(listings)
          .innerJoin(cards, eq(listings.cardId, cards.id))
          .where(eq(listings.id, refId));
        if (row) {
          await db.update(listings).set({ status: 'sold' }).where(eq(listings.id, refId));
          await db.insert(trades).values({
            listingId: row.listing.id,
            buyer: source, // the signer of a buy_now is the buyer
            seller: row.listing.seller,
            priceUsdc: row.listing.priceUsdc,
            feeUsdc: feeFor(row.listing.priceUsdc),
            royaltyUsdc: royaltyFor(row.listing.priceUsdc, row.card, row.listing.seller),
            settleTxHash: result.hash,
          });
        }
        break;
      }
      case 'purchase_escrow': {
        // The contract returns the new order id; the listing is now reserved.
        const [order] = await db.select().from(orders).where(eq(orders.id, refId));
        if (order) {
          await db
            .update(orders)
            .set({ contractOrderId: Number(result.returnValue), escrowTxHash: result.hash })
            .where(eq(orders.id, refId));
          await db.update(listings).set({ status: 'sold' }).where(eq(listings.id, order.listingId));
        }
        break;
      }
      case 'mark_shipped':
        await db.update(orders).set({ status: 'shipped' }).where(eq(orders.id, refId));
        break;
      case 'dispute':
        await db.update(orders).set({ status: 'disputed' }).where(eq(orders.id, refId));
        break;
      case 'confirm_receipt':
      case 'claim_timeout': {
        // Both release the escrow to the seller and deliver the card to the buyer.
        const { order, card } = await getOrderWithListingCard(refId);
        if (order.status !== 'released') {
          await db
            .update(orders)
            .set({ status: 'released', settleTxHash: result.hash })
            .where(eq(orders.id, refId));
          await recordOrderTrade(order, card, result.hash);
        }
        break;
      }
    }

    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// --- submit: passkey smart-wallet deployment (deploy-on-first-use), relay only ---
txRouter.post('/passkey-deploy', async (req, res, next) => {
  try {
    const { signedXdr } = submitTxSchema.parse(req.body);
    const result = await relaySubmitter().submit(signedXdr);
    res.json({ hash: result.hash, successful: result.successful });
  } catch (err) {
    next(err);
  }
});

// --- submit: passkey smart-wallet (gasless relay) + reconcile DB ---
//
// The browser builds + passkey-signs the marketplace call client-side (the
// relayer is the tx source, the smart wallet is the buyer), so this path does
// not reuse the `G…`-only build endpoints. It pre-flights the smart wallet's
// USDC, relays the signed envelope, and reconciles using the `C…` address as
// buyer of record. A relay/tx failure throws before any DB mutation.
txRouter.post('/passkey-submit', async (req, res, next) => {
  try {
    const input = passkeySubmitSchema.parse(req.body);
    const { listing, card } = await getListingWithCard(input.listingId);
    needContractId(listing.contractListingId, 'Listing');

    // Pre-flight the contract-account buyer's USDC (no classic trustline check;
    // tolerant of an undeployed wallet).
    const need = input.action === 'buy_now' ? listing.priceUsdc : input.amountUsdc;
    if (input.action === 'make_offer' && !need) {
      throw new PreflightError('amountUsdc is required for make_offer', 'BAD_REQUEST');
    }
    await requireSmartWalletUsdc(input.buyer, need!);

    const result = await relaySubmitter().submit(input.signedXdr);
    if (!result.successful) {
      throw new PreflightError('Relayed transaction did not succeed on-chain', 'TX_FAILED', {
        hash: result.hash,
      });
    }

    if (input.action === 'buy_now') {
      await db.update(listings).set({ status: 'sold' }).where(eq(listings.id, listing.id));
      await db.insert(trades).values({
        listingId: listing.id,
        buyer: input.buyer, // the smart-wallet C-address, not the relay source
        seller: listing.seller,
        priceUsdc: listing.priceUsdc,
        feeUsdc: feeFor(listing.priceUsdc),
        royaltyUsdc: royaltyFor(listing.priceUsdc, card, listing.seller),
        settleTxHash: result.hash,
      });
    } else {
      // make_offer: the relayer submitted the tx, so recover the contract's
      // returned offer id from the on-chain result for later reconciliation.
      const returned = await transactionReturnValue(result.hash);
      const contractOfferId = returned == null ? null : Number(returned);
      await db.insert(offers).values({
        listingId: listing.id,
        buyer: input.buyer,
        amountUsdc: need!,
        status: 'open',
        contractOfferId: Number.isFinite(contractOfferId) ? contractOfferId : null,
        escrowTxHash: result.hash,
      });
    }

    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// --- submit: passkey smart-wallet listing (gasless relay) + reconcile DB ---
//
// A smart-wallet seller (`C…`) can't authorize the `G…`-only `/list` build, so
// the browser builds + passkey-signs the `list` call (the relayer is the tx
// source, the smart wallet is the seller) and posts the envelope here. We
// pre-flight card ownership, relay, recover the contract listing id from the
// result, and insert the listing with the `C…` address as seller of record.
// A relay/tx failure throws before any DB mutation.
txRouter.post('/passkey-list', async (req, res, next) => {
  try {
    const input = passkeyListSchema.parse(req.body);
    const [card] = await db.select().from(cards).where(eq(cards.id, input.cardId));
    if (!card) notFound('Card');
    if (!card.sacAddress) {
      throw new PreflightError('Card asset contract not deployed', 'CARD_SAC_MISSING');
    }
    await requireSmartWalletCard(input.seller, card.sacAddress);

    const result = await relaySubmitter().submit(input.signedXdr);
    if (!result.successful) {
      throw new PreflightError('Relayed transaction did not succeed on-chain', 'TX_FAILED', {
        hash: result.hash,
      });
    }

    // The contract's `list` returns the new listing id; recover it for later
    // settlement reconciliation (mirrors the classic `/submit` list path).
    const returned = await transactionReturnValue(result.hash);
    const contractListingId = returned == null ? null : Number(returned);
    const [listing] = await db
      .insert(listings)
      .values({
        cardId: card.id,
        seller: input.seller,
        priceUsdc: input.priceUsdc,
        status: 'open',
        contractListingId: Number.isFinite(contractListingId) ? contractListingId : null,
        escrowTxHash: result.hash,
      })
      .returning();

    res.json({ hash: result.hash, successful: true, refId: listing!.id });
  } catch (err) {
    next(err);
  }
});

// --- submit: passkey smart-wallet escrow order action (gasless relay) + reconcile ---
//
// A smart-wallet (`C…`) actor on the physical-escrow flow. The browser builds +
// passkey-signs the order call client-side and posts the envelope here; we relay
// it and reconcile the order row. `purchase_escrow` targets a listing (and
// recovers the new order id from the result); the rest target an existing order.
txRouter.post('/passkey-order', async (req, res, next) => {
  try {
    const input = passkeyOrderSchema.parse(req.body);

    if (input.action === 'purchase_escrow') {
      if (!input.listingId) {
        throw new PreflightError('listingId is required for purchase_escrow', 'BAD_REQUEST');
      }
      const { listing } = await getListingWithCard(input.listingId);
      needContractId(listing.contractListingId, 'Listing');
      if (listing.fulfillment !== 'physical') {
        throw new PreflightError('Listing is not a physical (escrow) listing', 'WRONG_FULFILLMENT');
      }
      await requireSmartWalletUsdc(input.account, listing.priceUsdc);

      const result = await relaySubmitter().submit(input.signedXdr);
      if (!result.successful) {
        throw new PreflightError('Relayed transaction did not succeed on-chain', 'TX_FAILED', {
          hash: result.hash,
        });
      }
      const returned = await transactionReturnValue(result.hash);
      const contractOrderId = returned == null ? null : Number(returned);
      const [order] = await db
        .insert(orders)
        .values({
          listingId: listing.id,
          buyer: input.account,
          seller: listing.seller,
          amountUsdc: listing.priceUsdc,
          status: 'funded',
          contractOrderId: Number.isFinite(contractOrderId) ? contractOrderId : null,
          escrowTxHash: result.hash,
        })
        .returning();
      await db.update(listings).set({ status: 'sold' }).where(eq(listings.id, listing.id));
      res.json({ hash: result.hash, successful: true, refId: order!.id });
      return;
    }

    // Existing-order actions.
    if (!input.orderId) {
      throw new PreflightError('orderId is required for this action', 'BAD_REQUEST');
    }
    const { order, card } = await getOrderWithListingCard(input.orderId);
    needContractId(order.contractOrderId, 'Order');

    const result = await relaySubmitter().submit(input.signedXdr);
    if (!result.successful) {
      throw new PreflightError('Relayed transaction did not succeed on-chain', 'TX_FAILED', {
        hash: result.hash,
      });
    }

    if (input.action === 'mark_shipped') {
      await db.update(orders).set({ status: 'shipped' }).where(eq(orders.id, order.id));
    } else if (input.action === 'dispute') {
      await db.update(orders).set({ status: 'disputed' }).where(eq(orders.id, order.id));
    } else if (input.action === 'confirm_receipt') {
      await db
        .update(orders)
        .set({ status: 'released', settleTxHash: result.hash })
        .where(eq(orders.id, order.id));
      await recordOrderTrade(order, card, result.hash);
    }

    res.json({ hash: result.hash, successful: true, refId: order.id });
  } catch (err) {
    next(err);
  }
});

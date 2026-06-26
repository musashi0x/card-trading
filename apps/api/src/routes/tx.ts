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
  MarketplaceContract,
  acceptOfferSchema,
  buyNowSchema,
  cancelListingSchema,
  cardAsset,
  listInputSchema,
  makeOfferSchema,
  submitTxSchema,
  toStroops,
  usdcAsset,
  withdrawOfferSchema,
  type TradeAction,
} from '@cardmkt/shared';
import { env } from '../env.js';
import {
  PreflightError,
  buildContractTx,
  buildTrustlineTx,
  requireBalance,
  requireTrustline,
  submitClassicTx,
  submitSignedTx,
} from '../stellar.js';

export const txRouter: Router = Router();

const contract = new MarketplaceContract(env.contractId);
const usdc = usdcAsset(env.usdc.code, env.usdc.issuer);
const { cards, listings, offers, trades } = schema;

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

    const op = contract.list(input.seller, card.sacAddress, toStroops(input.priceUsdc));
    const xdr = await buildContractTx(input.seller, op);

    const [listing] = await db
      .insert(listings)
      .values({
        cardId: card.id,
        seller: input.seller,
        priceUsdc: input.priceUsdc,
        status: 'open',
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
    }

    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

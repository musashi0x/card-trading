/**
 * Card minting — issue a brand-new card asset at runtime.
 *
 * Mounted at `/api/cards` and only when the platform issuer secret is configured
 * (never on mainnet). The platform issues the asset, deploys its Stellar Asset
 * Contract, optionally registers a creator royalty, and distributes copies to the
 * owner. Issuance is signed server-side with the platform issuer secret, so no
 * key ever reaches the browser.
 *
 *  - Smart-wallet (`C…`) owner: copies are minted gaslessly in one call.
 *  - Classic (`G…`) owner without a trustline: `mint` returns a `trustlineXdr`
 *    for the wallet to sign; once submitted, `POST /:id/distribute` delivers the
 *    copies.
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cardmkt/db';
import { cardAsset, mintAssetCode } from '@cardmkt/shared';
import { env } from '../env.js';
import {
  PreflightError,
  buildChangeTrustTx,
  deployCardSac,
  hasTrustline,
  isContractAddress,
  mintCardCopies,
  setCardRoyalty,
} from '../stellar.js';

export const cardsRouter: Router = Router();

const { cards } = schema;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

const mintSchema = z.object({
  owner: z.string().regex(STELLAR_ADDRESS, 'Must be a valid Stellar address (G… or C…)'),
  name: z.string().trim().min(1).max(80),
  set: z.string().trim().max(80).default(''),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']),
  // Accept an http(s) URL or a data: URL from the upload picker. Capped to keep
  // the JSON body (and the cards.image_url column) reasonable.
  imageUrl: z.string().min(1).max(2_000_000),
  supply: z.number().int().min(1).max(1000),
  royaltyBps: z.number().int().min(0).max(1000),
});

const distributeSchema = z.object({
  owner: z.string().regex(STELLAR_ADDRESS, 'Must be a valid Stellar address (G… or C…)'),
});

/** Pick an asset code not already used by an existing card (retry on collision). */
async function uniqueAssetCode(name: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = mintAssetCode(name);
    const existing = await db.select({ id: cards.id }).from(cards).where(eq(cards.assetCode, code));
    if (existing.length === 0) return code;
  }
  throw new PreflightError('Could not allocate a unique asset code — try again', 'CODE_COLLISION');
}

// POST /api/cards/mint — issue a new card asset and distribute copies to owner.
cardsRouter.post('/mint', async (req, res, next) => {
  try {
    if (!env.usdcIssuerSecret) {
      throw new PreflightError('Platform issuer secret not configured', 'NO_ISSUER_SECRET');
    }
    const body = mintSchema.parse(req.body);
    const issuer = env.platformIssuer;
    const secret = env.usdcIssuerSecret;

    // 1. Allocate the asset. A classic owner must be a real, funded account
    // *before* we deploy a SAC or write a row — `hasTrustline` throws
    // ACCOUNT_NOT_FOUND for a bogus owner, so this fails fast with no side effects.
    const assetCode = await uniqueAssetCode(body.name);
    const asset = cardAsset(assetCode, issuer);
    const classic = !isContractAddress(body.owner);
    const ownerTrusts = classic ? await hasTrustline(body.owner, asset) : true;

    // 2. Issue the asset + deploy its SAC (signed by the platform issuer).
    const sacAddress = await deployCardSac(asset, secret);

    // 3. Persist the card. Creator royalty only makes sense with a payee.
    const creatorAccount = body.royaltyBps > 0 ? body.owner : null;
    const [card] = await db
      .insert(cards)
      .values({
        assetCode,
        issuer,
        sacAddress,
        name: body.name,
        set: body.set,
        rarity: body.rarity,
        imageUrl: body.imageUrl,
        supply: body.supply,
        creatorAccount,
        royaltyBps: body.royaltyBps,
      })
      .returning();

    // 4. Register the creator royalty on-chain (admin-only), if any.
    if (body.royaltyBps > 0) {
      await setCardRoyalty(sacAddress, body.owner, body.royaltyBps, secret);
    }

    // 5. Distribute copies. A classic owner that doesn't trust the new asset yet
    // signs the returned trustline, then claims via `distribute`.
    if (classic && !ownerTrusts) {
      const trustlineXdr = await buildChangeTrustTx(body.owner, asset);
      res.json({
        card,
        minted: false,
        trustlineXdr,
        networkPassphrase: env.stellar.networkPassphrase,
      });
      return;
    }
    await mintCardCopies(asset, sacAddress, body.owner, body.supply, secret);
    res.json({ card, minted: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/cards/:id/distribute — deliver copies after a classic owner has
// established the trustline returned by `mint`.
cardsRouter.post('/:id/distribute', async (req, res, next) => {
  try {
    if (!env.usdcIssuerSecret) {
      throw new PreflightError('Platform issuer secret not configured', 'NO_ISSUER_SECRET');
    }
    const { owner } = distributeSchema.parse(req.body);
    const [card] = await db.select().from(cards).where(eq(cards.id, req.params.id));
    if (!card) throw new PreflightError('Card not found', 'CARD_NOT_FOUND');
    if (!card.sacAddress) throw new PreflightError('Card asset contract not deployed', 'NO_SAC');

    const asset = cardAsset(card.assetCode, card.issuer);
    if (!isContractAddress(owner) && !(await hasTrustline(owner, asset))) {
      throw new PreflightError('Establish a trustline before claiming copies', 'MISSING_TRUSTLINE', {
        assetCode: card.assetCode,
        assetIssuer: card.issuer,
      });
    }
    await mintCardCopies(asset, card.sacAddress, owner, card.supply, env.usdcIssuerSecret);
    res.json({ card, minted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Card minting — issue a brand-new card as a run of unique NFT copies on the
 * global "TopDeck Cards" collection contract (adopt-nft-standard).
 *
 * Mounted at `/api/cards` and only when the platform issuer secret is configured
 * (never on mainnet). For each of `supply` copies the platform calls the
 * collection's owner-only `mint(to, creator, royalty_bps)`, signed server-side
 * with the platform issuer/admin secret, so no key ever reaches the browser.
 * NFT ownership needs no trustline, so the flow is identical for classic (`G…`)
 * and smart-wallet (`C…`) owners — there is no trustline dance and no separate
 * distribute step.
 */

import { Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cardmkt/db';
import type { CardCopy } from '@cardmkt/shared';
import { env } from '../env.js';
import { dataUrlToBytes, ipfsClient } from '../lib/ipfs.js';
import { PreflightError, mintCollectionCopy } from '../stellar.js';

export const cardsRouter: Router = Router();

const { cards, cardCopies } = schema;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

const mintSchema = z.object({
  owner: z.string().regex(STELLAR_ADDRESS, 'Must be a valid Stellar address (G… or C…)'),
  name: z.string().trim().min(1).max(80),
  set: z.string().trim().max(80).default(''),
  rarity: z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary']),
  // Accept an http(s) URL or a data: URL from the upload picker. Capped to keep
  // the JSON body (and the cards.image_url column) reasonable.
  imageUrl: z.string().min(1).max(2_000_000),
  supply: z.number().int().min(1).max(1000),
  royaltyBps: z.number().int().min(0).max(1000),
  // Royalty payee registered on each minted token; defaults to `owner`. Lets a
  // platform mint to a holder while royalties flow to a separate creator wallet.
  creatorAccount: z.string().regex(STELLAR_ADDRESS, 'Must be a valid Stellar address (G… or C…)').optional(),
});

/**
 * Uploaded art (a `data:` URL from the picker) is pinned to IPFS and stored as
 * `ipfs://<CID>` when a provider is configured; otherwise — no provider, or an
 * already-hosted http(s) URL — the value is stored verbatim. Runs before any
 * DB write or on-chain mint so a pin failure aborts the whole request cleanly.
 */
async function pinImageIfConfigured(imageUrl: string): Promise<string> {
  if (!ipfsClient || !imageUrl.startsWith('data:')) return imageUrl;
  try {
    const { bytes, mimeType } = dataUrlToBytes(imageUrl);
    return `ipfs://${await ipfsClient.pin(bytes, mimeType)}`;
  } catch (err) {
    throw new PreflightError(
      `Could not pin card image to IPFS: ${err instanceof Error ? err.message : String(err)}`,
      'IPFS_PIN_FAILED',
    );
  }
}

function toCardCopyDto(row: typeof cardCopies.$inferSelect): CardCopy {
  return {
    id: row.id,
    cardId: row.cardId,
    tokenId: row.tokenId,
    serial: row.serial,
    owner: row.owner,
  };
}

// POST /api/cards/mint — issue a new card as `supply` unique NFT copies.
cardsRouter.post('/mint', async (req, res, next) => {
  try {
    if (!env.usdcIssuerSecret) {
      throw new PreflightError('Platform issuer secret not configured', 'NO_ISSUER_SECRET');
    }
    const body = mintSchema.parse(req.body);
    const secret = env.usdcIssuerSecret;

    // The royalty payee registered on-chain per token; defaults to the owner so
    // a plain mint (no separate creator) still registers *someone* as payee.
    const royaltyPayee = body.creatorAccount ?? body.owner;

    // 1. Pin uploaded art to IPFS (when configured) before any side effects.
    const imageUrl = await pinImageIfConfigured(body.imageUrl);

    // 2. Persist the card. Creator royalty only makes sense with a payee.
    const [card] = await db
      .insert(cards)
      .values({
        name: body.name,
        set: body.set,
        rarity: body.rarity,
        imageUrl,
        supply: body.supply,
        creatorAccount: body.royaltyBps > 0 ? royaltyPayee : null,
        royaltyBps: body.royaltyBps,
      })
      .returning();

    // 3. Mint `supply` unique copies on the collection, one at a time (each
    // mint is its own server-signed tx; token ids come back via the tx return
    // value). Serial = mint order within this card.
    const copies: CardCopy[] = [];
    for (let serial = 1; serial <= body.supply; serial++) {
      const tokenId = await mintCollectionCopy(body.owner, royaltyPayee, body.royaltyBps, secret);
      const [copy] = await db
        .insert(cardCopies)
        .values({ cardId: card!.id, tokenId, serial, owner: body.owner })
        .returning();
      copies.push(toCardCopyDto(copy!));
    }

    res.json({ card, copies });
  } catch (err) {
    next(err);
  }
});

// GET /api/cards/:id/copies[?owner=G…|C…] — a card's minted copies, ordered by
// serial. With `owner`, narrowed to the copies that wallet currently holds
// (per the Postgres mirror, kept in sync by the indexer/reconcilers).
cardsRouter.get('/:id/copies', async (req, res, next) => {
  try {
    const owner = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
    if (owner && !STELLAR_ADDRESS.test(owner)) {
      res.status(400).json({ error: 'Invalid owner address', code: 'INVALID_OWNER' });
      return;
    }
    const where = owner
      ? and(eq(cardCopies.cardId, req.params.id), eq(cardCopies.owner, owner))
      : eq(cardCopies.cardId, req.params.id);
    const rows = await db.select().from(cardCopies).where(where).orderBy(asc(cardCopies.serial));
    res.json(rows.map(toCardCopyDto));
  } catch (err) {
    next(err);
  }
});

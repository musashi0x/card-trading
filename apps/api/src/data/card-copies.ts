/**
 * `card_copies.owner` mirror updates. The chain (the collection's `owner_of`)
 * remains the source of truth; this mirror is written at the moment each
 * settlement path transfers a copy, so portfolio/catalog reads never need a
 * live contract call.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@cardmkt/db';

const { cardCopies, cards } = schema;

export async function setOwner(cardCopyId: string, owner: string): Promise<void> {
  await db.update(cardCopies).set({ owner }).where(eq(cardCopies.id, cardCopyId));
}

/** A card copy joined with its parent card metadata, or `null` if not found. */
export async function copyWithCard(cardCopyId: string) {
  const [row] = await db
    .select({ copy: cardCopies, card: cards })
    .from(cardCopies)
    .innerJoin(cards, eq(cardCopies.cardId, cards.id))
    .where(eq(cardCopies.id, cardCopyId));
  return row ?? null;
}

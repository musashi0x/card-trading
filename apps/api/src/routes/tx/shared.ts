import { MarketplaceContract, usdcAsset } from '@cardmkt/shared';
import { env } from '../../env.js';
import { PreflightError, requireTrustline } from '../../stellar.js';

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

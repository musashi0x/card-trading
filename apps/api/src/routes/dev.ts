/**
 * Dev-only helpers, mounted at `/api/dev` and only when not on mainnet.
 *
 * `fund-wallet` mints test USDC into a passkey smart wallet (a `C…` contract
 * account) so the first "Pay with Face ID" purchase has funds — removing the
 * one manual step in the demo. It signs server-side with the USDC issuer secret,
 * so no key ever reaches the browser.
 */

import { Router } from 'express';
import { z } from 'zod';
import { toStroops } from '@cardmkt/shared';
import { env } from '../env.js';
import { PreflightError, mintUsdcTo } from '../stellar.js';

export const devRouter: Router = Router();

const fundSchema = z.object({
  wallet: z.string().regex(/^C[A-Z2-7]{55}$/, 'Must be a valid Stellar contract address (C...)'),
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/)
    .optional(),
});

// POST /api/dev/fund-wallet — mint test USDC to a smart wallet.
devRouter.post('/fund-wallet', async (req, res, next) => {
  try {
    if (!env.usdcIssuerSecret) {
      throw new PreflightError('USDC issuer secret not configured', 'NO_ISSUER_SECRET');
    }
    const { wallet, amountUsdc } = fundSchema.parse(req.body);
    const amount = amountUsdc ?? '100';
    const result = await mintUsdcTo(wallet, toStroops(amount), env.usdcIssuerSecret);
    if (!result.successful) {
      throw new PreflightError('USDC mint did not succeed on-chain', 'MINT_FAILED', {
        hash: result.hash,
      });
    }
    res.json({ hash: result.hash, successful: true, amountUsdc: amount, wallet });
  } catch (err) {
    next(err);
  }
});

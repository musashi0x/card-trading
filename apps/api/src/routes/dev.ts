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
import { Asset } from '@stellar/stellar-sdk';
import { toStroops } from '@cardmkt/shared';
import { env } from '../env.js';
import { PreflightError, mintUsdcTo, hasTrustline, buildChangeTrustTx, getAccountBalances } from '../stellar.js';

export const devRouter: Router = Router();

const fundSchema = z.object({
  wallet: z.string().regex(/^[CG][A-Z2-7]{55}$/, 'Must be a valid Stellar contract or account address'),
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/)
    .optional(),
});

// GET /api/dev/balance/:address — query USDC & XLM balances and trustline status.
devRouter.get('/balance/:address', async (req, res, next) => {
  try {
    const address = req.params.address;
    if (!/^[CG][A-Z2-7]{55}$/.test(address)) {
      res.status(400).json({ error: 'Invalid account address', code: 'INVALID_ACCOUNT' });
      return;
    }
    const balances = await getAccountBalances(address);
    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// POST /api/dev/fund-wallet — mint test USDC to a smart wallet or classic account.
devRouter.post('/fund-wallet', async (req, res, next) => {
  try {
    if (!env.usdcIssuerSecret) {
      throw new PreflightError('USDC issuer secret not configured', 'NO_ISSUER_SECRET');
    }
    const { wallet, amountUsdc } = fundSchema.parse(req.body);
    const amount = amountUsdc ?? '100';

    const isContract = wallet.startsWith('C');
    if (!isContract) {
      const usdcAsset = new Asset(env.usdc.code, env.usdc.issuer);
      let trustlineExists = false;
      try {
        trustlineExists = await hasTrustline(wallet, usdcAsset);
      } catch (err) {
        trustlineExists = false;
      }

      if (!trustlineExists) {
        let changeTrustXdr;
        try {
          changeTrustXdr = await buildChangeTrustTx(wallet, usdcAsset);
        } catch (err: any) {
          // If the account does not exist on-chain (404), fund it via Friendbot first!
          if (
            (err instanceof PreflightError && err.code === 'ACCOUNT_NOT_FOUND') ||
            err?.response?.status === 404 ||
            err?.status === 404 ||
            String(err).includes('404')
          ) {
            console.log(`[faucet] Funding unfunded classic account ${wallet} via Friendbot`);
            const fbRes = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(wallet)}`);
            if (!fbRes.ok) {
              throw new Error(`Friendbot funding failed: status ${fbRes.status}`);
            }
            // Wait a moment for Horizon to ingest the account
            await new Promise((resolve) => setTimeout(resolve, 2000));
            changeTrustXdr = await buildChangeTrustTx(wallet, usdcAsset);
          } else {
            throw err;
          }
        }

        res.status(400).json({
          error: 'MISSING_TRUSTLINE',
          code: 'MISSING_TRUSTLINE',
          message: 'Account must establish a trustline to USDC first',
          details: {
            xdr: changeTrustXdr,
            networkPassphrase: env.stellar.networkPassphrase,
          }
        });
        return;
      }
    }

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


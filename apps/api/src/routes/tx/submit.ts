import { Router } from 'express';
import { submitTxSchema, resolveOrderSchema, type TradeAction } from '@cardmkt/shared';
import { env } from '../../env.js';
import { PreflightError, signAndSubmitAs, submitClassicTx } from '../../stellar.js';
import * as settle from '../../settlement/settle.js';
import { reconcile } from '../../settlement/reconcile.js';
import * as ordersRepo from '../../data/orders.js';
import * as tradesRepo from '../../data/trades.js';
import { contract, needContractId } from './shared.js';

export const submitRouter: Router = Router();

// --- submit: classic tx (trustline), no contract reconciliation ---
submitRouter.post('/submit-classic', async (req, res, next) => {
  try {
    const { signedXdr } = submitTxSchema.parse(req.body);
    const hash = await submitClassicTx(signedXdr);
    res.json({ hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// --- submit: classic signed XDR + reconcile DB ---
submitRouter.post('/submit', async (req, res, next) => {
  try {
    const { signedXdr } = submitTxSchema.parse(req.body);
    const action = req.body.action as TradeAction;
    const refId = req.body.refId as string;

    const result = await settle.signed(signedXdr);
    await reconcile(action, {
      refId,
      hash: result.hash,
      returnValue: result.returnValue,
      actor: settle.txSource(signedXdr),
    });

    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

// --- resolve: arbiter settles a disputed order (server-signed) ---
submitRouter.post('/resolve', async (req, res, next) => {
  try {
    const input = resolveOrderSchema.parse(req.body);
    if (!env.arbiterSecret) {
      const e = new PreflightError('Arbitration is not configured on this server', 'NO_ARBITER');
      e.status = 501;
      throw e;
    }
    const { order, card } = await ordersRepo.orderWithListingCard(input.orderId);
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
      await ordersRepo.markRefunded(order.id, result.hash);
    } else {
      await ordersRepo.markReleased(order.id, result.hash);
      await tradesRepo.recordOrderTrade(order, card, result.hash);
    }

    res.json({ hash: result.hash, successful: true });
  } catch (err) {
    next(err);
  }
});

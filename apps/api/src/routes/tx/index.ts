import { Router } from 'express';
import { buildRouter } from './build.js';
import { submitRouter } from './submit.js';
import { passkeyRouter } from './passkey.js';

export const txRouter: Router = Router();

txRouter.use(buildRouter);
txRouter.use(submitRouter);
txRouter.use(passkeyRouter);

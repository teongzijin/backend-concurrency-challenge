import { Router } from 'express';
import { z } from 'zod';
import { positiveMoney } from '../lib/validation';
import * as wagerService from '../services/wagerService';

export const walletsRouter = Router();

const params = z.object({ walletId: z.string().uuid() });
const body = z.object({ amount: positiveMoney });

walletsRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const { walletId } = params.parse(req.params);
    const { amount } = body.parse(req.body);
    const result = await wagerService.placeWager(walletId, amount);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
import { Router } from 'express';
import { z } from 'zod';
import { positiveMoney } from '../lib/validation';
import * as depositService from '../services/depositService';

export const depositsRouter = Router();

const body = z.object({
  memberId: z.string().uuid(),
  amount: positiveMoney,
  turnoverMultiplier: z.number().int().min(0).default(1),
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const input = body.parse(req.body);
    const ftx = await depositService.createDeposit(input);
    res.status(201).json({ id: ftx.id, pspRef: ftx.pspRef, status: ftx.status, amount: ftx.amount });
  } catch (err) {
    next(err);
  }
});
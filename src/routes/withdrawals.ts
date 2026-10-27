import { Router } from 'express';
import { z } from 'zod';
import { positiveMoney } from '../lib/validation';
import * as withdrawalService from '../services/withdrawalService';

export const withdrawalsRouter = Router();

const body = z.object({
  memberId: z.string().uuid(),
  amount: positiveMoney,
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const input = body.parse(req.body);
    const result = await withdrawalService.createWithdrawal(input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
import { Router } from 'express';
import { z } from 'zod';
import { decimalString } from '../lib/validation';
import * as pspCallbackService from '../services/pspCallbackService';

export const pspRouter = Router();

const body = z.object({
  pspRef: z.string().min(1).max(200),
  status: z.enum(['completed', 'failed']),
  amount: decimalString,
});

pspRouter.post('/callbacks', async (req, res, next) => {
  try {
    const input = body.parse(req.body);
    const result = await pspCallbackService.handlePspCallback(input);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
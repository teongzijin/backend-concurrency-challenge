import { z } from 'zod';
import { dec } from './money';

// Max 18 integer digits and 18 decimals, matching DECIMAL(36,18).
export const decimalString = z
  .string()
  .regex(/^\d{1,18}(\.\d{1,18})?$/, 'must be a non-negative decimal string');

// zod runs refinements even when the regex above failed, so this must never throw.
export const positiveMoney = decimalString.refine((v) => {
  try {
    return dec(v).gt(0);
  } catch {
    return false;
  }
}, 'must be positive');
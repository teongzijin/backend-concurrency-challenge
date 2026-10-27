import { randomUUID } from 'crypto';
import { FundingTransaction, Wallet } from '../db/models';
import { AppError } from '../lib/errors';
import { dec, toDb } from '../lib/money';

// Single row insert, so no explicit transaction needed (see convention in memberService).
export async function createDeposit(input: { memberId: string; amount: string; turnoverMultiplier: number }) {
  const wallet = await Wallet.findOne({ where: { memberId: input.memberId } });
  if (!wallet) throw new AppError(404, 'member_not_found', 'Member or wallet not found');

  return FundingTransaction.create({
    memberId: input.memberId,
    walletId: wallet.id,
    type: 'deposit',
    status: 'pending',
    amount: toDb(dec(input.amount)),
    turnoverMultiplier: input.turnoverMultiplier,
    pspRef: `psp_${randomUUID()}`,
  });
}
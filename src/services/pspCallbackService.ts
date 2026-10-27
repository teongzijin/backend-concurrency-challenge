import { sequelize } from '../db/sequelize';
import { FundingTransaction } from '../db/models';
import { FundingStatus } from '../db/models/fundingTransaction';
import { AppError } from '../lib/errors';
import { dec, toDb } from '../lib/money';
import { assertTransition } from './fundingStateMachine';
import { applyLedgerEntry, lockWallet } from './walletLedger';

export interface PspCallbackInput {
  pspRef: string;
  status: 'completed' | 'failed';
  amount: string;
}

export type CallbackOutcome =
  | 'credited'
  | 'failed'
  | 'rejected_amount_mismatch'
  | 'duplicate'
  | 'ignored_unknown_ref';

export async function handlePspCallback(
  input: PspCallbackInput,
): Promise<{ outcome: CallbackOutcome; fundingTxId?: string }> {
  return sequelize.transaction(async (t) => {
    // Lock order: funding tx first, then wallet. Concurrent deliveries of the same
    // callback queue here; the loser re-reads the row after the winner commits.
    const ftx = await FundingTransaction.findOne({
      where: { pspRef: input.pspRef, type: 'deposit' },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!ftx) {
      // eslint-disable-next-line no-console
      console.warn(`[psp] callback for unknown pspRef ${input.pspRef}`);
      return { outcome: 'ignored_unknown_ref' };
    }

    // Decide the target state from the callback alone, so a replay of the same
    // callback always maps to the same target.
    const amountMatches = dec(input.amount).isEqualTo(dec(ftx.amount));
    let target: FundingStatus;
    let failureReason: string | null = null;
    if (input.status === 'completed' && amountMatches) {
      target = 'completed';
    } else {
      target = 'failed';
      failureReason = input.status === 'failed' ? 'psp_failed' : 'amount_mismatch';
    }

    if (ftx.status !== 'pending') {
      if (ftx.status === target) return { outcome: 'duplicate', fundingTxId: ftx.id };
      throw new AppError(409, 'conflicting_callback', `Funding transaction is already ${ftx.status}`);
    }

    assertTransition(ftx.status, target);
    ftx.status = target;
    ftx.pspReportedAmount = toDb(dec(input.amount));
    ftx.failureReason = failureReason;

    if (target === 'completed') {
      const wallet = await lockWallet(ftx.walletId, t);
      await applyLedgerEntry(
        wallet,
        {
          type: 'deposit',
          delta: dec(ftx.amount),
          fundingTxId: ftx.id,
          turnoverRequiredDelta: dec(ftx.amount).times(ftx.turnoverMultiplier),
        },
        t,
      );
    } else if (failureReason === 'amount_mismatch') {
      // eslint-disable-next-line no-console
      console.error(
        `[psp] AMOUNT MISMATCH pspRef=${input.pspRef} expected=${ftx.amount} got=${input.amount}. Needs reconciliation.`,
      );
    }

    await ftx.save({ transaction: t });

    if (target === 'completed') return { outcome: 'credited', fundingTxId: ftx.id };
    return {
      outcome: failureReason === 'amount_mismatch' ? 'rejected_amount_mismatch' : 'failed',
      fundingTxId: ftx.id,
    };
  });
}
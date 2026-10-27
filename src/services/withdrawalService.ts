import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet } from '../db/models';
import { AppError } from '../lib/errors';
import { dec, toDb } from '../lib/money';
import { applyLedgerEntry, lockWallet } from './walletLedger';

export async function createWithdrawal(input: { memberId: string; amount: string }) {
  // wallet.id never changes, so reading it outside the transaction is safe.
  const found = await Wallet.findOne({ where: { memberId: input.memberId } });
  if (!found) throw new AppError(404, 'member_not_found', 'Member or wallet not found');

  return sequelize.transaction(async (t) => {
    const wallet = await lockWallet(found.id, t);
    const amount = dec(input.amount);

    const outstanding = dec(wallet.turnoverRequired).minus(wallet.turnoverAccrued);
    if (outstanding.gt(0)) {
      throw new AppError(422, 'turnover_not_met', 'Turnover requirement not met', {
        outstanding: toDb(outstanding),
        required: wallet.turnoverRequired,
        accrued: wallet.turnoverAccrued,
      });
    }

    const ftx = await FundingTransaction.create(
      {
        memberId: input.memberId,
        walletId: wallet.id,
        type: 'withdrawal',
        status: 'pending',
        amount: toDb(amount),
        turnoverMultiplier: 0,
        pspRef: null,
      },
      { transaction: t },
    );

    // Throws insufficient_balance (422) and rolls everything back, including the ftx above.
    await applyLedgerEntry(wallet, { type: 'withdrawal', delta: amount.negated(), fundingTxId: ftx.id }, t);

    return { id: ftx.id, status: ftx.status, amount: ftx.amount, balance: wallet.balance };
  });
}
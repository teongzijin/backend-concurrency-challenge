import { sequelize } from '../db/sequelize';
import { dec } from '../lib/money';
import { applyLedgerEntry, lockWallet } from './walletLedger';

export async function placeWager(walletId: string, amount: string) {
  return sequelize.transaction(async (t) => {
    const wallet = await lockWallet(walletId, t);
    const amt = dec(amount);
    const tx = await applyLedgerEntry(
      wallet,
      { type: 'wager', delta: amt.negated(), turnoverAccruedDelta: amt },
      t,
    );
    return {
      id: tx.id,
      balance: wallet.balance,
      turnoverAccrued: wallet.turnoverAccrued,
    };
  });
}
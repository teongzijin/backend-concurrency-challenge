import { Transaction } from 'sequelize';
import BigNumber from 'bignumber.js';
import { Wallet, WalletTx } from '../db/models';
import { WalletTxType } from '../db/models/walletTx';
import { AppError } from '../lib/errors';
import { dec, toDb, ZERO } from '../lib/money';

// SELECT ... FOR UPDATE. Every balance change must start here.
export async function lockWallet(walletId: string, t: Transaction): Promise<Wallet> {
  const wallet = await Wallet.findByPk(walletId, { lock: t.LOCK.UPDATE, transaction: t });
  if (!wallet) throw new AppError(404, 'wallet_not_found', 'Wallet not found');
  return wallet;
}

export interface LedgerEntryInput {
  type: WalletTxType;
  delta: BigNumber; // signed
  fundingTxId?: string | null;
  turnoverRequiredDelta?: BigNumber;
  turnoverAccruedDelta?: BigNumber;
}

// Caller MUST hold the wallet row lock (lockWallet) inside transaction `t`.
// Updates balance and turnover, and appends the ledger row, in the same transaction.
export async function applyLedgerEntry(wallet: Wallet, e: LedgerEntryInput, t: Transaction): Promise<WalletTx> {
  const newBalance = dec(wallet.balance).plus(e.delta);
  if (newBalance.isLessThan(0)) {
    throw new AppError(422, 'insufficient_balance', 'Insufficient balance', {
      balance: wallet.balance,
    });
  }
  wallet.balance = toDb(newBalance);
  wallet.turnoverRequired = toDb(dec(wallet.turnoverRequired).plus(e.turnoverRequiredDelta ?? ZERO));
  wallet.turnoverAccrued = toDb(dec(wallet.turnoverAccrued).plus(e.turnoverAccruedDelta ?? ZERO));
  await wallet.save({ transaction: t });

  return WalletTx.create(
    {
      walletId: wallet.id,
      fundingTxId: e.fundingTxId ?? null,
      type: e.type,
      amount: toDb(e.delta),
      balanceAfter: toDb(newBalance),
    },
    { transaction: t },
  );
}
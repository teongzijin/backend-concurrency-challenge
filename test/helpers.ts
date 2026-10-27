import request from 'supertest';
import { Express } from 'express';
import { Wallet, WalletTx } from '../src/db/models';
import { dec, ZERO } from '../src/lib/money';

export async function createMember(app: Express, username = 'alice01') {
  const res = await request(app).post('/members').send({ username });
  return { memberId: res.body.member.id as string, walletId: res.body.wallet.id as string };
}

export async function createDeposit(app: Express, memberId: string, amount: string, turnoverMultiplier?: number) {
  const res = await request(app).post('/deposits').send({ memberId, amount, turnoverMultiplier });
  return res.body as { id: string; pspRef: string };
}

export async function balanceOf(walletId: string): Promise<string> {
  const w = await Wallet.findByPk(walletId);
  return dec(w!.balance).toFixed(2);
}

// Core invariant: the ledger always explains the balance.
export async function expectLedgerMatchesBalance(walletId: string) {
  const txs = await WalletTx.findAll({ where: { walletId } });
  const sum = txs.reduce((s, tx) => s.plus(tx.amount), ZERO);
  const wallet = await Wallet.findByPk(walletId);
  expect(sum.toFixed(18)).toBe(dec(wallet!.balance).toFixed(18));
}

// Creates a deposit and completes it via the callback.
export async function fundWallet(app: Express, memberId: string, amount: string, turnoverMultiplier = 1) {
  const dep = await createDeposit(app, memberId, amount, turnoverMultiplier);
  await request(app).post('/psp/callbacks').send({ pspRef: dep.pspRef, status: 'completed', amount });
  return dep;
}
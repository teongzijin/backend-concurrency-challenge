import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet } from '../src/db/models';
import { balanceOf, createMember, expectLedgerMatchesBalance, fundWallet } from './helpers';

const app = createApp();

beforeAll(async () => { await sequelize.authenticate(); });
beforeEach(async () => { await sequelize.truncate({ cascade: true }); });
afterAll(async () => { await sequelize.close(); });

const wager = (walletId: string, amount: string) =>
  request(app).post(`/wallets/${walletId}/wagers`).send({ amount });

describe('POST /wallets/:walletId/wagers', () => {
  it('debits the wallet, accrues turnover and writes a ledger entry', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100.00');
    const res = await wager(walletId, '10.00');
    expect(res.status).toBe(201);
    expect(await balanceOf(walletId)).toBe('90.00');
    const w = await Wallet.findByPk(walletId);
    expect(Number(w!.turnoverAccrued)).toBe(10);
    await expectLedgerMatchesBalance(walletId);
  });

  it('rejects a wager larger than the balance', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '5.00');
    const res = await wager(walletId, '10.00');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
    expect(await balanceOf(walletId)).toBe('5.00');
  });

  it('concurrent wagers cannot overdraw a wallet', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100.00');

    // 20 x 10.00 against a 100.00 balance: exactly 10 may succeed.
    const results = await Promise.all(Array.from({ length: 20 }, () => wager(walletId, '10.00')));
    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);

    expect(ok).toHaveLength(10);
    expect(rejected).toHaveLength(10);
    expect(await balanceOf(walletId)).toBe('0.00');
    const w = await Wallet.findByPk(walletId);
    expect(Number(w!.turnoverAccrued)).toBe(100);
    await expectLedgerMatchesBalance(walletId);
  });

  it('returns 404 for an unknown wallet and 400 for a malformed id', async () => {
    expect((await wager('00000000-0000-4000-8000-000000000000', '1.00')).status).toBe(404);
    expect((await wager('not-a-uuid', '1.00')).status).toBe(400);
  });
});
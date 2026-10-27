import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTransaction } from '../src/db/models';
import { balanceOf, createMember, expectLedgerMatchesBalance, fundWallet } from './helpers';

const app = createApp();

beforeAll(async () => { await sequelize.authenticate(); });
beforeEach(async () => { await sequelize.truncate({ cascade: true }); });
afterAll(async () => { await sequelize.close(); });

const withdraw = (memberId: string, amount: string) =>
  request(app).post('/withdrawals').send({ memberId, amount });
const wager = (walletId: string, amount: string) =>
  request(app).post(`/wallets/${walletId}/wagers`).send({ amount });

describe('POST /withdrawals', () => {
  it('turnover lock blocks and unblocks withdrawal correctly', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100.00', 1); // requires 100 turnover
    await fundWallet(app, memberId, '100.00', 0); // requires none; balance now 200

    let res = await withdraw(memberId, '50.00');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('turnover_not_met');
    expect(Number(res.body.outstanding)).toBe(100);

    await wager(walletId, '60.00');
    res = await withdraw(memberId, '50.00');
    expect(res.status).toBe(422);
    expect(Number(res.body.outstanding)).toBe(40);

    await wager(walletId, '40.00'); // accrued 100 >= required 100
    res = await withdraw(memberId, '50.00');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');

    expect(await balanceOf(walletId)).toBe('50.00'); // 200 - 100 wagered - 50 withdrawn
    await expectLedgerMatchesBalance(walletId);
  });

  it('a blocked withdrawal changes nothing', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100.00', 1);
    await withdraw(memberId, '50.00');
    expect(await balanceOf(walletId)).toBe('100.00');
    expect(await FundingTransaction.count({ where: { type: 'withdrawal' } })).toBe(0);
  });

  it('rejects a withdrawal above the balance and leaves no pending record', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '20.00', 0);
    const res = await withdraw(memberId, '50.00');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
    expect(await balanceOf(walletId)).toBe('20.00');
    expect(await FundingTransaction.count({ where: { type: 'withdrawal' } })).toBe(0);
  });

  it('concurrent withdrawals cannot overdraw a wallet', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100.00', 0);

    // 5 x 30.00 against 100.00: exactly 3 may succeed.
    const results = await Promise.all(Array.from({ length: 5 }, () => withdraw(memberId, '30.00')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(2);
    expect(await balanceOf(walletId)).toBe('10.00');
    expect(await FundingTransaction.count({ where: { type: 'withdrawal' } })).toBe(3);
    await expectLedgerMatchesBalance(walletId);
  });

  it('returns 404 for an unknown member', async () => {
    const res = await withdraw('00000000-0000-4000-8000-000000000000', '10.00');
    expect(res.status).toBe(404);
  });
});
import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { WalletTx } from '../src/db/models';
import { balanceOf, createDeposit, createMember, expectLedgerMatchesBalance } from './helpers';

const app = createApp();

beforeAll(async () => { await sequelize.authenticate(); });
beforeEach(async () => { await sequelize.truncate({ cascade: true }); });
afterAll(async () => { await sequelize.close(); });

const callback = (pspRef: string, amount = '100.50', status = 'completed') =>
  request(app).post('/psp/callbacks').send({ pspRef, status, amount });

describe('POST /deposits', () => {
  it('creates a pending deposit and moves no money', async () => {
    const { memberId, walletId } = await createMember(app);
    const res = await request(app).post('/deposits').send({ memberId, amount: '100.50' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.pspRef).toBeTruthy();
    expect(await balanceOf(walletId)).toBe('0.00');
  });

  it('rejects non-positive and malformed amounts', async () => {
    const { memberId } = await createMember(app);
    for (const amount of ['0', '-5', 'abc', '1e3']) {
      const res = await request(app).post('/deposits').send({ memberId, amount });
      expect(res.status).toBe(400);
    }
  });
});

describe('POST /psp/callbacks', () => {
  it('credits once for a completed callback', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '100.50');
    const res = await callback(dep.pspRef);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('credited');
    expect(await balanceOf(walletId)).toBe('100.50');
    await expectLedgerMatchesBalance(walletId);
  });

  it('sequential duplicate callback does not double-credit', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '100.50');
    await callback(dep.pspRef);
    const again = await callback(dep.pspRef);
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe('duplicate');
    expect(await balanceOf(walletId)).toBe('100.50');
    expect(await WalletTx.count({ where: { walletId } })).toBe(1);
  });

  it('concurrent duplicate callbacks do not double-credit', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '100.50');
    const results = await Promise.all(Array.from({ length: 10 }, () => callback(dep.pspRef)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const outcomes = results.map((r) => r.body.outcome);
    expect(outcomes.filter((o) => o === 'credited')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(9);
    expect(await balanceOf(walletId)).toBe('100.50');
    expect(await WalletTx.count({ where: { walletId } })).toBe(1);
    await expectLedgerMatchesBalance(walletId);
  });

  it('amount mismatch does not credit and marks the deposit failed', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '100.50');
    const res = await callback(dep.pspRef, '999.00');
    expect(res.body.outcome).toBe('rejected_amount_mismatch');
    expect(await balanceOf(walletId)).toBe('0.00');
    // Replaying the same bad callback is a harmless duplicate.
    expect((await callback(dep.pspRef, '999.00')).body.outcome).toBe('duplicate');
  });

  it('failed callback then conflicting completed callback is rejected with 409', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '100.50');
    await callback(dep.pspRef, '100.50', 'failed');
    const res = await callback(dep.pspRef, '100.50', 'completed');
    expect(res.status).toBe(409);
    expect(await balanceOf(walletId)).toBe('0.00');
  });

  it('unknown pspRef is acknowledged and ignored', async () => {
    const res = await callback('psp_does_not_exist');
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('ignored_unknown_ref');
  });
});
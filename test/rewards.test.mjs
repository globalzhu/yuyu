import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFamilyHandler } from '../accounts.mjs';

test('grants, purchases, refunds and renames preserve one consistent family balance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'yuyu-rewards-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let families = createFamilyHandler({ directory });
  let cookie;
  let name = 'original';
  const password = randomUUID();
  async function call(action, body) {
    const req = { method: body ? 'POST' : 'GET', headers: { cookie, 'x-yuyu-family': '1', 'x-yuyu-family-name': name }, socket: {} };
    const res = { setHeader(header, value) { if (header === 'Set-Cookie') cookie = value.split(';')[0]; } };
    return families(req, res, action, () => body, (_, status, result) => {
      assert.equal(status, 200);
      return result;
    });
  }
  await call('register', { name, password });
  const grant = { name, operation: 'grant', amount: 5, reason: '讲清了思路', requestId: randomUUID() };
  await Promise.all([families.adminModerate(grant), families.adminModerate(grant)]);
  assert.equal((await call('journal')).shells, 5);
  const gift = { id: randomUUID(), title: '绘本', price: 5, active: true };
  await families.saveGift(gift);
  const request = { giftId: gift.id, price: 5, requestId: randomUUID() };
  await Promise.all([call('redeem', request), call('redeem', request)]);
  const purchases = await Promise.allSettled([call('redeem', { ...request, requestId: randomUUID() }), call('purchase', { itemId:'sunhat' })]);
  assert(purchases.every(r => r.status === 'rejected'));
  assert.equal((await call('gifts')).orders.length, 1);
  assert.equal((await call('journal')).shells, 0);
  const refund = { name, operation:'refund', orderId:request.requestId };
  await Promise.all([families.adminModerate(refund), families.adminModerate(refund)]);
  await assert.rejects(families.adminModerate({ ...refund, operation:'deliver' }), {status:409});
  await families.adminModerate({ name, operation:'rename', value:'renamed' });
  families = createFamilyHandler({ directory });
  await assert.rejects(call('journal'), {status:401});
  await assert.rejects(call('login', {name,password}), {status:401});
  await assert.rejects(call('register', {name,password}), {status:409});
  name = 'renamed';
  await call('login', {name,password});
  const wallet = await call('journal');
  assert.equal(wallet.shells, 5);
  assert.equal(wallet.solvedCount, 0);
  assert.deepEqual((await call('gifts')).orders.map(o => o.status), ['refunded']);
  await families.saveGift({...gift, active:false});
  await assert.rejects(call('redeem', {...request,requestId:randomUUID()}), {status:409});
});

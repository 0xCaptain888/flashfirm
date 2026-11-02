import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareTestnet, verifyDeployment, base58 } from '../src/near-deployment.mjs';

const config = () => ({ network: 'testnet', contractId: 'treasury.testnet', init: { buyer: 'buyer.testnet', recipients: ['buyer.testnet', 'worker.testnet'], evaluators: ['a.testnet', 'b.testnet', 'c.testnet'], arbiter: 'arbiter.testnet', task_root: 'a'.repeat(64), policy_hash: 'b'.repeat(64), deadline_ns: '200000000000', appeal_window_ns: '60000000000', arbitration_window_ns: '60000000000' } });
test('testnet preparation rejects mainnet, overlapping identities, unsafe times and hidden fields', () => {
  assert.equal(prepareTestnet(config(), 1n).broadcast, false);
  for (const mutate of [c => c.network = 'mainnet', c => c.init.buyer = 'buyer.near', c => c.init.arbiter = 'a.testnet', c => c.init.evaluators[0] = 'worker.testnet', c => c.init.deadline_ns = 200000000000, c => c.init.appeal_window_ns = '1', c => c.init.secret = 'never-accepted']) {
    const c = config(); mutate(c); assert.throws(() => prepareTestnet(c, 1n));
  }
  assert.throws(() => prepareTestnet(config(), 200000000000n));
});
test('deployment verification checks bytecode and every pinned role/commitment', () => {
  const plan = prepareTestnet(config(), 1n), wasm = Buffer.from('test bytes');
  const account = { code_hash: base58(createHash('sha256').update(wasm).digest()) };
  const status = { ...plan.init, version: 'flashfirm-treasury/0.2', arbitration_deadline_ns: plan.arbitrationDeadlineNs };
  assert.equal(verifyDeployment(plan, wasm, account, status).valid, true);
  assert.equal(verifyDeployment(plan, wasm, account, status).paymentVerified, false);
  for (const key of ['buyer', 'evaluators', 'recipients', 'task_root', 'policy_hash', 'arbiter', 'deadline_ns', 'appeal_window_ns', 'arbitration_deadline_ns', 'version']) {
    assert.equal(verifyDeployment(plan, wasm, account, { ...status, [key]: 'tampered' }).valid, false, key);
  }
  assert.equal(verifyDeployment(plan, Buffer.from('wrong build'), account, status).valid, false);
});
test('base58 preserves leading zero bytes', () => {
  assert.equal(base58(Buffer.alloc(32)), '1'.repeat(32));
  assert.equal(base58(Buffer.from([0, 0, 1])), '112');
  assert.equal(base58(Buffer.from([58])), '21');
});

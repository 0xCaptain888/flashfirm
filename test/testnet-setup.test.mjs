import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTransactions } from '../src/testnet-setup.mjs';
const buyer = 'buyer.testnet';
const ids = ['treasury', 'reviewa', 'reviewb', 'reviewc', 'arbiter', 'worker'].map(n => `${n}.${buyer}`);
const fixture = () => ({ version: 'flashfirm-testnet-setup/1', controller: buyer, accounts: ids.map((accountId, i) => ({ accountId, publicKey: `ed25519:${'1'.repeat(42)}${i + 2}`, amountYocto: i ? '100000000000000000000000' : '2500000000000000000000000' })), config: { network: 'testnet', contractId: ids[0], init: { buyer, evaluators: ids.slice(1,4), recipients: [buyer,ids[5]], arbiter: ids[4], task_root: 'a'.repeat(64), policy_hash: 'b'.repeat(64), deadline_ns: '9999999999999999999', appeal_window_ns: '60000000000', arbitration_window_ns: '60000000000' } } });
test('setup pins six new child accounts, exact funding and child-only keys', () => {
  const prepared = setupTransactions(fixture(), buyer, 0n);
  assert.equal(prepared.totalYocto, String(3n * 10n ** 24n));
  assert.equal(prepared.transactions.length, 6);
  assert.ok(prepared.transactions.every(t => t.receiverId !== buyer && t.actions[0].type === 'CreateAccount'));
});
test('setup rejects redirected funds, mismatched signer, extra accounts and duplicate keys', () => {
  assert.throws(() => setupTransactions(fixture(), 'attacker.testnet'), /controller/);
  for (const mutate of [s => s.accounts[0].amountYocto = '3000000000000000000000000', s => s.accounts[1].accountId = 'attacker.testnet', s => s.accounts.push(s.accounts[0]), s => s.accounts[1].publicKey = s.accounts[0].publicKey]) {
    const s = fixture(); mutate(s); assert.throws(() => setupTransactions(s, buyer, 0n));
  }
});

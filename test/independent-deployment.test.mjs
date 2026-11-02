import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyPair } from 'near-api-js';
import { DEVELOPER_ACCOUNT as developer, BUYER_ACCOUNT as buyer, validateIndependentSetup, verifyRoleKey, requireFinalSuccess } from '../src/independent-deployment.mjs';
function fixture() {
  const accounts = ['treasury', 'review-a', 'review-b', 'review-c', 'arbiter', 'worker'].map((role, index) => ({ accountId: `${role}.${developer}`, publicKey: KeyPair.fromRandom('ed25519').getPublicKey().toString(), amountYocto: index === 0 ? '2500000000000000000000000' : '100000000000000000000000' }));
  return { version: 'flashfirm-independent-testnet/1', developer, independentOperators: false, accounts, config: { network: 'testnet', contractId: accounts[0].accountId, init: { buyer, evaluators: accounts.slice(1, 4).map(a => a.accountId), recipients: [buyer, accounts[5].accountId], arbiter: accounts[4].accountId, task_root: 'a'.repeat(64), policy_hash: 'b'.repeat(64), deadline_ns: '1000000000000', appeal_window_ns: '60000000000', arbitration_window_ns: '60000000000' } } };
}
test('independent deployment cannot redirect buyer, developer funding, roles or key ownership', () => {
  assert.equal(validateIndependentSetup(fixture()).init.buyer, buyer);
  for (const mutate of [s => s.developer = buyer, s => s.config.network = 'mainnet', s => s.independentOperators = true, s => s.accounts[1].amountYocto = '1000000000000000000000000', s => s.accounts[1].accountId = 'outsider.testnet', s => s.accounts[1].publicKey = s.accounts[0].publicKey, s => s.config.init.buyer = developer]) {
    const value = fixture(); mutate(value); assert.throws(() => validateIndependentSetup(value));
  }
});
test('account ownership requires exactly the pinned full-access public key', () => {
  const role = fixture().accounts[0], key = { public_key: role.publicKey, access_key: { permission: 'FullAccess' } };
  verifyRoleKey(role, { keys: [key] });
  for (const keys of [[], [key, key], [{ ...key, public_key: fixture().accounts[0].publicKey }], [{ ...key, access_key: { permission: { FunctionCall: {} } } }]]) assert.throws(() => verifyRoleKey(role, { keys }));
});
test('provisioning proof rejects nonfinal, failed or redirected execution', () => {
  const valid = { transaction: { signer_id: developer, receiver_id: `treasury.${developer}` }, final_execution_status: 'FINAL', status: { SuccessValue: '' }, receipts_outcome: [{ outcome: { status: { SuccessValue: '' } } }] };
  const check = outcome => requireFinalSuccess(outcome, developer, `treasury.${developer}`);
  check(valid);
  for (const mutate of [o => o.final_execution_status = 'EXECUTED_OPTIMISTIC', o => o.status = { Failure: {} }, o => o.transaction.signer_id = buyer, o => o.transaction.receiver_id = buyer, o => o.receipts_outcome[0].outcome.status = { Failure: {} }, o => delete o.receipts_outcome]) { const value = structuredClone(valid); mutate(value); assert.throws(() => check(value)); }
});

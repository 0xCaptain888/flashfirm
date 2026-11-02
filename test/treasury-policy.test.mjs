import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestnet, treasuryAction, checkTransaction } from '../src/treasury-policy.mjs';
import { inspectTreasury, nearRpc } from '../src/near-rpc.mjs';

const config = { network: 'testnet', contractId: 'treasury.testnet', init: { buyer: 'buyer.testnet', recipients: ['buyer.testnet', 'worker.testnet'], evaluators: ['a.testnet', 'b.testnet', 'c.testnet'], arbiter: 'arbiter.testnet', task_root: 'a'.repeat(64), policy_hash: 'b'.repeat(64), deadline_ns: '200000000000', appeal_window_ns: '60000000000', arbitration_window_ns: '60000000000' } };
const plan = prepareTestnet(config, 1n);
const state = overrides => ({ ...plan.init, version: 'flashfirm-treasury/0.2', arbitration_deadline_ns: plan.arbitrationDeadlineNs, phase: 'Empty', funded_yocto: '1000', approvals: [false, false, false], credits_yocto: ['0','1000'], pending_yocto: ['0','0'], release_at_ns: null, release_allowed: false, plan_hash: 'c'.repeat(64), challenge_root: null, resolution_root: null, ...overrides });
const act = (status, actor, method, input = {}, now = 1n) => treasuryAction(plan, status, actor, method, input, now);
test('wallet composer enforces testnet, buyer role, deposit cap and exact allocation', () => {
  const tx = act(state(), 'buyer.testnet', 'fund', { amount_yocto: '1000' });
  assert.equal(tx.receiverId, 'treasury.testnet'); assert.equal(tx.actions[0].params.deposit, '1000');
  for (const actor of ['worker.testnet', 'buyer.near']) assert.throws(() => act(state(), actor, 'fund', { amount_yocto: '1000' }));
  for (const amount of ['0', '10000000000000000000001', '1e3', 1000, '-1']) assert.throws(() => act(state(), 'buyer.testnet', 'fund', { amount_yocto: amount }));
  assert.throws(() => act(state({ phase: 'Funded' }), 'buyer.testnet', 'propose', { amounts_yocto: ['0','999'], evidence_root: 'd'.repeat(64) }));
  assert.equal(act(state({ phase: 'Funded' }), 'buyer.testnet', 'propose', { amounts_yocto: ['0','1000'], evidence_root: 'd'.repeat(64) }).actions[0].params.deposit, '0');
  assert.throws(() => act(state({ policy_hash: '0'.repeat(64) }), 'buyer.testnet', 'fund', { amount_yocto: '1000' }));
});
test('wallet actions respect immutable quorum, challenge, arbitration and refund timing', () => {
  const review = state({ phase: 'Reviewing' });
  assert.equal(act(review, 'a.testnet', 'approve').actions[0].params.args.plan_hash, review.plan_hash);
  assert.throws(() => act({ ...review, approvals: [true,false,false] }, 'a.testnet', 'approve'));
  assert.throws(() => act(review, 'buyer.testnet', 'approve'));
  const approved = state({ phase: 'Approved', release_at_ns: '100', release_allowed: false });
  assert.throws(() => act(approved, 'buyer.testnet', 'claim_for', { recipient: 'worker.testnet' }, 99n));
  act(approved, 'worker.testnet', 'challenge', { reason_root: 'd'.repeat(64) }, 99n);
  assert.throws(() => act(approved, 'worker.testnet', 'challenge', { reason_root: 'd'.repeat(64) }, 100n));
  const challenged = { ...approved, challenge_root: 'd'.repeat(64) };
  assert.throws(() => act(challenged, 'buyer.testnet', 'resolve_challenge', { uphold: true, resolution_root: 'e'.repeat(64) }));
  act(challenged, 'arbiter.testnet', 'resolve_challenge', { uphold: false, resolution_root: 'e'.repeat(64) });
  assert.throws(() => act(challenged, 'buyer.testnet', 'make_refund_available', {}, BigInt(plan.arbitrationDeadlineNs)-1n));
  act(challenged, 'buyer.testnet', 'make_refund_available', {}, BigInt(plan.arbitrationDeadlineNs));
  assert.throws(() => act(approved, 'buyer.testnet', 'make_refund_available', {}, BigInt(plan.arbitrationDeadlineNs)));
  act({ ...approved, release_allowed: true }, 'sponsor.testnet', 'claim_for', { recipient: 'worker.testnet' });
  assert.throws(() => act({ ...approved, release_allowed: true }, 'sponsor.testnet', 'claim_for', { recipient: 'outsider.testnet' }));
});
function outcome(tx) {
  const p = tx.actions[0].params;
  return { final_execution_status: 'FINAL', transaction: { hash: 'x'.repeat(44), signer_id: tx.signerId, receiver_id: tx.receiverId, actions: [{ FunctionCall: { method_name: p.methodName, deposit: p.deposit, gas: p.gas, args: btoa(JSON.stringify(p.args)) } }] }, transaction_outcome: { outcome: { status: { SuccessReceiptId: 'receipt' } } }, receipts_outcome: [{ outcome: { status: { SuccessValue: btoa('true') } } }], status: { SuccessValue: btoa('true') } };
}
test('wallet result verifier rejects pending, wrong actions, failed receipts and false callbacks', () => {
  const tx = act(state({ phase: 'Approved', release_allowed: true }), 'sponsor.testnet', 'claim_for', { recipient: 'worker.testnet' });
  assert.equal(checkTransaction(outcome(tx), tx).transferCallbackSucceeded, true);
  for (const change of [o => o.final_execution_status = 'EXECUTED', o => o.transaction.signer_id = 'other.testnet', o => o.transaction.receiver_id = 'other.testnet', o => o.transaction.actions[0].FunctionCall.deposit = '1', o => o.transaction.actions[0].FunctionCall.args = btoa('{"recipient":"other.testnet"}'), o => o.status.SuccessValue = btoa('false'), o => o.receipts_outcome[0].outcome.status = { Failure: { error: 'failed' } }, o => o.receipts_outcome = []]) {
    const result = outcome(tx); change(result); assert.throws(() => checkTransaction(result, tx));
  }
});
test('RPC inspection binds code, pinned configuration and fresh views to one final block', async () => {
  const now = String(BigInt(Date.now()) * 1_000_000n);
  const mock = async (method, params) => {
    if (method === 'status') return { chain_id: 'testnet' };
    if (method === 'block') return { header: { hash: 'block', height: 1, timestamp_nanosec: now } };
    assert.equal(params.block_id, 'block');
    if (params.request_type === 'view_account') return { code_hash: 'tested-code', block_hash: 'block' };
    return { block_hash: 'block', result: [...new TextEncoder().encode(JSON.stringify(state()))] };
  };
  assert.equal((await inspectTreasury(plan, 'tested-code', mock)).blockHash, 'block');
  await assert.rejects(inspectTreasury(plan, 'wrong-code', mock), /tested build/);
  await assert.rejects(inspectTreasury(plan, 'tested-code', async (m,p) => m === 'status' ? { chain_id: 'mainnet' } : mock(m,p)), /Wrong RPC/);
  await assert.rejects(inspectTreasury(plan, 'tested-code', async (m,p) => m === 'block' ? { header: { hash:'block', timestamp_nanosec: '1' } } : mock(m,p)), /stale/);
  await assert.rejects(inspectTreasury(plan, 'tested-code', async (m,p) => { const r = await mock(m,p); return m === 'query' ? { ...r, block_hash: 'different' } : r; }), /Inconsistent/);
});
test('RPC transport rejects oversized and explicit error responses', async () => {
  await assert.rejects(nearRpc('status', [], async () => new Response(JSON.stringify({ error: {} }))), /rejected/);
  await assert.rejects(nearRpc('status', [], async () => new Response('x'.repeat(2_000_001))), /too large/);
});

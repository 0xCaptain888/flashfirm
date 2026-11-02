import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, createPublicKey } from 'node:crypto';
import { identity, seal, canonical } from '../src/protocol.mjs';
import { base58 } from '../src/near-deployment.mjs';
import { verifyReviewerBinding } from '../src/reviewer-binding.mjs';
function fixture() {
  const reviewer = identity(), account = identity(), now = 1000000;
  const expected = { accountId: 'review.testnet', reviewerKey: reviewer.publicKey, nonce: 'a'.repeat(64), policyHash: 'b'.repeat(64), audience: 'https://flashfirm.example' };
  const key = createPublicKey(account.publicKey).export({ format: 'der', type: 'spki' }).subarray(-32);
  const payload = { ...expected, version: 'flashfirm-reviewer-binding/1', network: 'testnet', issuedAt: now - 100, expiresAt: now + 100000, nearPublicKey: 'ed25519:' + base58(key) };
  const envelope = { reviewerSeal: seal(payload, reviewer), nearSignature: sign(null, Buffer.from(canonical(payload)), account.privateKey).toString('base64') };
  const rpc = async method => method === 'status' ? { chain_id: 'testnet' } : method === 'block' ? { header: { hash: 'block', timestamp_nanosec: String(BigInt(now) * 1000000n) } } : { block_hash: 'block', keys: [{ public_key: payload.nearPublicKey, access_key: { permission: 'FullAccess' } }] };
  return { envelope, expected, rpc, now };
}
test('reviewer and account signatures bind to a fresh pinned account key', async () => {
  const f = fixture(), result = await verifyReviewerBinding(f.envelope, f.expected, f.rpc, f.now);
  assert.equal(result.verified, true); assert.equal(result.independentOperatorVerified, false);
});
test('binding rejects replay context, wrong account control, stale proof and changed signature', async () => {
  const f = fixture();
  await assert.rejects(verifyReviewerBinding(f.envelope, { ...f.expected, nonce: 'c'.repeat(64) }, f.rpc, f.now));
  await assert.rejects(verifyReviewerBinding(f.envelope, f.expected, f.rpc, f.now + 100001));
  await assert.rejects(verifyReviewerBinding(f.envelope, f.expected, async method => method === 'query' ? { block_hash: 'block', keys: [] } : f.rpc(method), f.now));
  await assert.rejects(verifyReviewerBinding({ ...f.envelope, nearSignature: Buffer.alloc(64).toString('base64') }, f.expected, f.rpc, f.now));
});

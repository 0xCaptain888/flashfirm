import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCbor, validateNitroClaims, verifyNitroAttestation } from '../src/nitro-attestation.mjs';
test('bounded CBOR rejects duplicate keys, trailing bytes, indefinite lengths and truncation', () => {
  for (const value of ['a201010102', '0000', '9fff', '59010001', 'dbffffffffffffffff']) assert.throws(() => decodeCbor(Buffer.from(value, 'hex')));
  assert.equal(decodeCbor(Buffer.from('a1013822', 'hex')).get(1), -35);
});
test('attestation claims bind nonce, task, key, age and production PCR allowlist', () => {
  const expected = { nonce: Buffer.alloc(32, 1), publicKey: Buffer.from('key'), taskDigest: Buffer.alloc(32, 2), pcrs: { 0: 'a'.repeat(96), 1: 'b'.repeat(96), 2: 'c'.repeat(96) } };
  const claims = new Map([['digest', 'SHA384'], ['module_id', 'test'], ['timestamp', 1000000], ['nonce', expected.nonce], ['public_key', expected.publicKey], ['user_data', expected.taskDigest], ['pcrs', new Map(Object.entries(expected.pcrs).map(([key, value]) => [Number(key), Buffer.from(value, 'hex')]))]]);
  assert.equal(validateNitroClaims(claims, expected, 1000000).moduleId, 'test');
  assert.throws(() => validateNitroClaims(claims, { ...expected, nonce: Buffer.alloc(32) }, 1000000));
  assert.throws(() => validateNitroClaims(claims, expected, 1200001));
  assert.throws(() => validateNitroClaims(claims, { ...expected, pcrs: { ...expected.pcrs, 0: '0'.repeat(96) } }, 1000000));
});
test('unconfigured trust root cannot mark any document verified', async () => {
  await assert.rejects(verifyNitroAttestation(Buffer.from('test'), {}, 'not a certificate'));
});

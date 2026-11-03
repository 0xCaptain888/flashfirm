import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyPublicPhalaProof} from '../scripts/verify-phala-proof.mjs';

test('recorded real public task replays under pinned policy and rejects changed evidence', async () => {
  const [proof, policy, source] = await Promise.all([
    readFile(new URL('../evidence/phala-public-task.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../evidence/phala-readiness.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../tee/phala-worker.mjs', import.meta.url)),
  ]);
  const result = verifyPublicPhalaProof(proof, policy, source);
  assert.equal(result.status, 'RECORDED_PUBLIC_TASK_PROOF_REPRODUCED');
  assert.equal(result.freshChallengeExecuted, false);
  assert.equal(result.verification.rawQuoteBinding, 'RECORDED_QUOTE_BYTES_ONLY');
  const changed = structuredClone(proof);
  changed.signedResult.result.status = 'PASS';
  assert.throws(() => verifyPublicPhalaProof(changed, policy, source), /SIGNATURE_OR_CONTENT/);
  const changedCompose = structuredClone(proof);
  changedCompose.expected.dockerCompose += '\n';
  assert.throws(() => verifyPublicPhalaProof(changedCompose, policy, source), /POLICY/);
  assert.throws(() => verifyPublicPhalaProof(proof, policy, Buffer.from('replacement worker')), /POLICY/);
  const raw = Buffer.from(proof.bundle.attestation.quote, 'hex'); raw[568] ^= 1;
  assert.throws(() => verifyPublicPhalaProof(proof, policy, source, proof.hardwareVerification, raw), /RAW_QUOTE_MISMATCH/);
  const changedHardware = structuredClone(proof.hardwareVerification);
  changedHardware.quote.body.reportdata = '00'.repeat(64);
  assert.throws(() => verifyPublicPhalaProof(proof, policy, source, changedHardware), /VERIFIER_QUOTE_MISMATCH/);
});

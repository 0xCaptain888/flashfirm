import {readFile} from 'node:fs/promises';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {canonical, digest, quotationGate} from '../tee/phala-worker.mjs';
import {verifyPhalaEvidence} from '../src/phala-attestation.mjs';

export function verifyPublicPhalaProof(proof, policy, workerSource, hardware = proof.hardwareVerification, officialQuote) {
  const observedAt = Date.parse(proof.observedAt);
  if (proof.version !== 'flashfirm-phala-public-proof/v1' || !Number.isSafeInteger(observedAt) ||
    policy.status !== 'REAL_PUBLIC_TASK_VERIFIED_CVM_STOPPED' ||
    proof.build.image !== policy.image || proof.build.sourceSha256 !== policy.workerSourceSha256 ||
    proof.build.sourceSha256 !== createHash('sha256').update(workerSource).digest('hex') ||
    digest(proof.expected.dockerCompose) !== policy.dockerComposeSha256 ||
    proof.build.dockerComposeSha256 !== policy.dockerComposeSha256 ||
    JSON.parse(proof.expected.dockerCompose).services.app.image !== policy.image ||
    proof.task.sources.length !== 1 || proof.task.sources[0].id !== 'mainnet-policy' ||
    proof.task.claims.length !== 2 || digest(proof.task) !== proof.expected.taskDigest) throw Error('PUBLIC_PROOF_POLICY_MISMATCH');
  const raw = Buffer.from(proof.bundle.attestation.quote, 'hex');
  if (officialQuote && !raw.equals(officialQuote)) throw Error('OFFICIAL_RAW_QUOTE_MISMATCH');
  // Historical replay only: this does not make the old nonce fresh again.
  const verification = verifyPhalaEvidence(proof.bundle, {...proof.expected, appId: policy.appId},
    hardware, observedAt, officialQuote ?? raw);
  if (!officialQuote) {
    verification.hardwareSignatureVerifiedVia = 'Recorded official API verdict; offline replay only';
    verification.rawQuoteBinding = 'RECORDED_QUOTE_BYTES_ONLY';
  }
  const signed = proof.signedResult, key = createPublicKey({
    key: Buffer.from(proof.bundle.context.signingPublicKey, 'base64'), type: 'spki', format: 'der',
  });
  if (canonical(signed.context) !== canonical(proof.bundle.context) ||
    signed.resultDigest !== digest(signed.result) ||
    canonical(signed.result) !== canonical(quotationGate(proof.task)) ||
    !verify(null, Buffer.from(canonical({context: signed.context, result: signed.result, resultDigest: signed.resultDigest})),
      key, Buffer.from(signed.signature, 'base64')) ||
    signed.result.status !== 'CHALLENGED' || signed.result.claims[0].status !== 'EXACT_QUOTATION' ||
    signed.result.claims[1].status !== 'UNSUPPORTED_QUOTATION') throw Error('PUBLIC_RESULT_SIGNATURE_OR_CONTENT_MISMATCH');
  return {status: 'RECORDED_PUBLIC_TASK_PROOF_REPRODUCED', observedAt: proof.observedAt,
    verification, resultDigest: signed.resultDigest, result: signed.result.status,
    historicalProof: true, freshChallengeExecuted: false, confidentialProductionReady: false,
    trust: 'Offline replay uses a recorded official API verdict; use --online to independently recheck hardware now.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== '--online')) throw Error('USAGE: verify-phala-proof.mjs [--online]');
  const proof = JSON.parse(await readFile('evidence/phala-public-task.json', 'utf8'));
  const policy = JSON.parse(await readFile('evidence/phala-readiness.json', 'utf8'));
  const source = await readFile('tee/phala-worker.mjs');
  let hardware, raw;
  if (process.argv.includes('--online')) {
    if (process.env.FLASHFIRM_USE_SYSTEM_PROXY === '1') {
      const {ProxyAgent, setGlobalDispatcher} = await import('../cloudflare/node_modules/undici/index.js');
      setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
    }
    const response = await fetch('https://cloud-api.phala.com/api/v1/attestations/verify', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({hex: proof.bundle.attestation.quote}),
      redirect: 'error', signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw Error('OFFICIAL_VERIFIER_HTTP_' + response.status);
    hardware = await response.json();
    if (!/^[a-f0-9]{64}$/.test(hardware.checksum ?? '')) throw Error('INVALID_OFFICIAL_REPORT_ID');
    const download = await fetch('https://cloud-api.phala.com/api/v1/attestations/raw/' + hardware.checksum, {
      redirect: 'error', signal: AbortSignal.timeout(45000),
    });
    if (!download.ok) throw Error('OFFICIAL_RAW_QUOTE_HTTP_' + download.status);
    raw = Buffer.from(await download.arrayBuffer());
  }
  const result = verifyPublicPhalaProof(proof, policy, source, hardware, raw);
  if (hardware) {
    result.status = 'HARDWARE_REVERIFIED_HISTORICAL_PUBLIC_TASK';
    result.trust = 'Hardware verdict and exact raw quote independently fetched now from the official API over TLS; not local Intel DCAP verification.';
  }
  console.log(JSON.stringify(result, null, 2));
}

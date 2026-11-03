import {readFile, writeFile} from 'node:fs/promises';
import {verifyPublicPhalaProof} from './verify-phala-proof.mjs';

// Explicit publication of a public-document test only. Never copy an entire
// .runtime directory or include client encryption keys, provider secrets or env.
const directory = process.argv[2];
if (!/^\.runtime\/phala\/run-[a-zA-Z0-9]+$/.test(directory ?? '')) throw Error('RUN_DIRECTORY_REQUIRED');
const load = async name => JSON.parse(await readFile(directory + '/' + name + '.json', 'utf8'));
const [receipt, request, bundle, hardware, signedResult, policy, source, originalSource, raw] = await Promise.all([
  load('receipt'), load('request'), load('attestation'), load('hardware-verification'), load('signed-result'),
  readFile('evidence/phala-readiness.json', 'utf8').then(JSON.parse), readFile('tee/phala-worker.mjs'),
  readFile('docs/MAINNET-PAYMENT.md', 'utf8'), readFile(directory + '/official-quote.bin'),
]);
if (receipt.status !== 'HARDWARE_AND_APPLICATION_VERIFIED_PUBLIC_TASK' ||
  request.task.sources.length !== 1 || request.task.sources[0].text !== originalSource ||
  !raw.equals(Buffer.from(bundle.attestation.quote, 'hex'))) throw Error('PUBLIC_TEST_ONLY');
const proof = {version: 'flashfirm-phala-public-proof/v1', observedAt: receipt.observedAt,
  build: receipt.build, expected: request.expected, task: request.task,
  bundle: {context: bundle.context, attestation: {quote: bundle.attestation.quote, event_log: bundle.attestation.event_log},
    info: {tcb_info: bundle.info.tcb_info}},
  hardwareVerification: {success: hardware.success, checksum: hardware.checksum,
    verified_at: hardware.verified_at, quote: {header: hardware.quote.header, body: hardware.quote.body, verified: hardware.quote.verified}},
  signedResult, scope: 'Historical public quotation task. No remote model inference, private data, production OS/KMS trust or fresh online session claimed.',
};
verifyPublicPhalaProof(proof, policy, source, hardware, raw);
await writeFile('evidence/phala-public-task.json', JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({status: 'PUBLIC_PHALA_PROOF_EXPORTED', output: 'evidence/phala-public-task.json',
  providerSecretsPublished: false, walletKeysPublished: false, privateSourcePublished: false}));

import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {digest, prepareEncryptedTask} from '../tee/phala-worker.mjs';
import {parseTdxQuote, verifyPhalaEvidence} from '../src/phala-attestation.mjs';

// This command performs a public quotation task only. No provider secret is read.
const endpoint = new URL(process.argv[2]);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
  !/^[a-zA-Z0-9.-]+\.phala\.network$/.test(endpoint.hostname) || endpoint.search ||
  endpoint.hash || endpoint.pathname !== '/') throw Error('PHALA_HTTPS_ROOT_ENDPOINT_REQUIRED');
if (process.env.FLASHFIRM_USE_SYSTEM_PROXY === '1') {
  const {ProxyAgent, setGlobalDispatcher} = await import('../cloudflare/node_modules/undici/index.js');
  setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const dockerCompose = await readFile('.runtime/phala/docker-compose.json', 'utf8');
const build = JSON.parse(await readFile('.runtime/phala/build.json', 'utf8'));
if (digest(dockerCompose) !== build.dockerComposeSha256) throw Error('BUILD_MANIFEST_MISMATCH');
// Pinned public repository documentation; provenance remains explicit.
const text = await readFile('docs/MAINNET-PAYMENT.md', 'utf8');
const quote = text.split('\n').find(line => line.length > 60 && !line.startsWith('#'));
if (!quote) throw Error('PUBLIC_TEST_QUOTATION_REQUIRED');
const task = {version: 'flashfirm-quotation-task/v1', sources: [{id: 'mainnet-policy', text, sha256: digest(text)}],
  claims: [{id: 'policy', sourceId: 'mainnet-policy', quote},
    {id: 'invented', sourceId: 'mainnet-policy', quote: 'FlashFirm guarantees every wallet broadcast is automatically safe and irreversible.'}]};
const expected = {nonce: randomBytes(32).toString('hex'), taskDigest: digest(task), expiresAt: Date.now() + 300000, dockerCompose};
await mkdir('.runtime/phala', {recursive: true, mode: 0o700});
const directory = await mkdtemp('.runtime/phala/run-');
const save = async (name, data) => writeFile(directory + '/' + name, JSON.stringify(data, null, 2) + '\n', {mode: 0o600});
await save('request.json', {endpoint: endpoint.href, expected, task, build, created: new Date().toISOString()});
async function json(url, body) {
  const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000)});
  const text = await response.text();
  if (text.length > 2097152) throw Error('RESPONSE_TOO_LARGE');
  if (!response.ok) throw Error('REMOTE_HTTP_' + response.status);
  return JSON.parse(text);
}
try {
  const bundle = await json(new URL('/attest', endpoint), {nonce: expected.nonce, taskDigest: expected.taskDigest, expiresAt: expected.expiresAt});
  await save('attestation.json', bundle);
  parseTdxQuote(bundle.attestation?.quote);
  // Official API permanently publishes quotes by checksum. Only public task
  // hashes, ephemeral public keys and a random challenge are sent here.
  const hardware = await json('https://cloud-api.phala.com/api/v1/attestations/verify', {hex: bundle.attestation?.quote});
  await save('hardware-verification.json', hardware);
  const verification = verifyPhalaEvidence(bundle, expected, hardware);
  await save('verification.json', verification);
  const client = prepareEncryptedTask(bundle, task);
  const response = await json(new URL('/run', endpoint), client.request);
  await save('encrypted-response.json', response);
  const signedResult = client.decrypt(response);
  await save('signed-result.json', signedResult);
  if (signedResult.result.status !== 'CHALLENGED' ||
    signedResult.result.claims[0]?.status !== 'EXACT_QUOTATION' ||
    signedResult.result.claims[1]?.status !== 'UNSUPPORTED_QUOTATION') throw Error('EXPECTED_QUOTATION_GATE_NOT_OBSERVED');
  const receipt = {version: 'flashfirm-phala-live/v1', observedAt: new Date().toISOString(),
    status: 'HARDWARE_AND_APPLICATION_VERIFIED_PUBLIC_TASK', endpoint: endpoint.href, build,
    verification, result: signedResult, evidenceDirectory: directory,
    realHardwareQuote: true, encryptedTaskDelivered: true, paidModelCalls: 0,
    confidentialProductionReady: false, cvmLifecycle: 'MUST_STOP_AFTER_TEST_AND_CHECK_STORAGE_BILLING'};
  await save('receipt.json', receipt);
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  await save('failure.json', {status: 'NOT_VERIFIED', reason: error.message, at: new Date().toISOString()});
  console.error(JSON.stringify({status: 'NOT_VERIFIED', reason: error.message, evidenceDirectory: directory}));
  process.exitCode = 1;
}

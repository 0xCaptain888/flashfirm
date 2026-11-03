import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes, generateKeyPairSync} from 'node:crypto';
import {createWorker, workerServer, digest, quotationGate, prepareEncryptedTask, requestReportData} from '../tee/phala-worker.mjs';
import {parseTdxQuote, verifyPhalaEvidence} from '../src/phala-attestation.mjs';

const now = 1800000000000;
const source = 'A public, pinned document contains this exact quotation.';
const task = {version: 'flashfirm-quotation-task/v1',
  sources: [{id: 'public', text: source, sha256: digest(source)}],
  claims: [{id: 'one', sourceId: 'public', quote: source}]};
const challenge = () => ({nonce: randomBytes(32).toString('hex'), taskDigest: digest(task), expiresAt: now + 120000});
const signingPublicKey = generateKeyPairSync('ed25519').publicKey.export({type: 'spki', format: 'der'}).toString('base64');
const encryptionPublicKey = generateKeyPairSync('x25519').publicKey.export({type: 'spki', format: 'der'}).toString('base64');
function fakeEvidence(reportData, dockerCompose = 'expected compose') {
  const appCompose = JSON.stringify({docker_compose_file: dockerCompose, public_logs: false, public_sysinfo: false});
  let rtmr3 = Buffer.alloc(48);
  const events = [
    {imr: 3, event_type: 0x08000001, event: 'system-preparing', event_payload: ''},
    {imr: 3, event_type: 0x08000001, event: 'app-id', event_payload: 'ab'.repeat(20)},
    {imr: 3, event_type: 0x08000001, event: 'compose-hash', event_payload: digest(appCompose)},
  ];
  for (const event of events) {
    const type = Buffer.alloc(4); type.writeUInt32LE(event.event_type);
    const bytes = Buffer.concat([type, Buffer.from(':' + event.event + ':'), Buffer.from(event.event_payload, 'hex')]);
    const computed = createHash('sha384').update(bytes).digest();
    event.digest = computed.toString('hex');
    rtmr3 = createHash('sha384').update(Buffer.concat([rtmr3, computed])).digest();
  }
  // Synthetic unsigned quote framing for parser/policy tests, never hardware evidence.
  const quote = Buffer.alloc(637);
  quote.writeUInt16LE(4, 0); quote.writeUInt16LE(2, 2); quote.writeUInt32LE(0x81, 4);
  quote.writeUInt32LE(1, 632);
  rtmr3.copy(quote, 520); Buffer.from(reportData, 'hex').copy(quote, 568);
  return {attestation: {quote: quote.toString('hex'), event_log: JSON.stringify(events)},
    info: {tcb_info: JSON.stringify({app_compose: appCompose})}};
}
// Simulated verifier ONLY for policy unit tests.
function fakeHardware(bundle) {
  const parsed = parseTdxQuote(bundle.attestation.quote);
  return {success: true, checksum: parsed.checksum,
    quote: {verified: true, header: {version: 4, tee_type: 'TEE_TDX'}, body: parsed.body}};
}
test('encrypted request and signed encrypted response bind exact task and reject replay', async () => {
  const worker = createWorker({now: () => now, rpc: async () => ({testOnly: true})});
  const ch = challenge(), attestation = await worker.attest(ch);
  const client = prepareEncryptedTask(attestation, task);
  assert.equal(JSON.stringify(client.request).includes(source), false);
  const response = worker.run(client.request);
  assert.equal(JSON.stringify(response).includes('EXACT_QUOTATION'), false);
  assert.equal(client.decrypt(response).result.status, 'PASS');
  assert.throws(() => worker.run(client.request), /SESSION_EXPIRED_OR_USED/);
  await assert.rejects(worker.attest(ch), /REPLAY/);
  const changed = structuredClone(response); changed.tag = randomBytes(16).toString('base64');
  assert.throws(() => client.decrypt(changed));
});
test('changed task, malformed keys, used or expired challenges and unsupported quotations fail closed', async () => {
  let clock = now;
  const worker = createWorker({now: () => clock, rpc: async () => ({testOnly: true})});
  const attestation = await worker.attest(challenge());
  assert.throws(() => prepareEncryptedTask(attestation, {...task, claims: []}), /BINDING/);
  const client = prepareEncryptedTask(attestation, task);
  assert.throws(() => worker.run({...client.request, publicKey: 'bad'}));
  assert.throws(() => worker.run(client.request), /SESSION_EXPIRED_OR_USED/);
  const next = await worker.attest(challenge());
  const nextClient = prepareEncryptedTask(next, task); clock += 120001;
  assert.throws(() => worker.run(nextClient.request), /SESSION_EXPIRED_OR_USED/);
  const bad = structuredClone(task); bad.claims[0].quote = 'An invented quotation with no source support';
  assert.equal(quotationGate(bad).status, 'CHALLENGED');
  bad.sources[0].text += 'tampering';
  assert.throws(() => quotationGate(bad), /INVALID_SOURCE/);
});
test('Phala evidence needs independently fetched hardware result, exact compose and challenge', () => {
  const expected = {...challenge(), dockerCompose: 'expected compose'};
  const context = {version: 'flashfirm-phala-context/v1', nonce: expected.nonce,
    taskDigest: expected.taskDigest, expiresAt: expected.expiresAt,
    signingPublicKey, encryptionPublicKey};
  const bundle = {context, ...fakeEvidence(requestReportData(context))};
  const hardware = fakeHardware(bundle);
  const result = verifyPhalaEvidence(bundle, expected, hardware, now);
  assert.equal(result.expectedWorkloadVerified, true);
  assert.equal(result.secretReleaseAllowed, false);
  assert.equal(result.platformMeasurementsIndependentlyVerified, false);
  assert.throws(() => verifyPhalaEvidence(bundle, expected, null, now), /HARDWARE/);
  assert.throws(() => verifyPhalaEvidence(bundle, {...expected, nonce: '00'.repeat(32)}, hardware, now), /BINDING/);
  assert.throws(() => verifyPhalaEvidence(bundle, {...expected, dockerCompose: 'substituted'}, hardware, now), /WORKLOAD/);
  assert.throws(() => verifyPhalaEvidence(bundle, expected, {...hardware, checksum: '00'.repeat(32)}, now), /HARDWARE/);
  assert.throws(() => verifyPhalaEvidence(bundle, expected, hardware, now + 120001), /BINDING/);
  const changed = structuredClone(bundle);
  changed.context.signingPublicKey = generateKeyPairSync('ed25519').publicKey.export({type: 'spki', format: 'der'}).toString('base64');
  assert.throws(() => verifyPhalaEvidence(changed, expected, hardware, now), /REPORT_DATA/);
});
test('event payload changes cannot be concealed behind replaying the original digest', () => {
  const expected = {...challenge(), dockerCompose: 'expected compose'};
  const context = {version: 'flashfirm-phala-context/v1', nonce: expected.nonce, taskDigest: expected.taskDigest,
    expiresAt: expected.expiresAt, signingPublicKey, encryptionPublicKey};
  const bundle = {context, ...fakeEvidence(requestReportData(context))};
  const hardware = fakeHardware(bundle), events = JSON.parse(bundle.attestation.event_log);
  events[2].event_payload = '00'.repeat(32);
  bundle.attestation.event_log = JSON.stringify(events);
  assert.throws(() => verifyPhalaEvidence(bundle, expected, hardware, now), /EVENT_PAYLOAD_DIGEST/);
  const raw = Buffer.from(bundle.attestation.quote, 'hex');
  raw[168] = 1;
  assert.throws(() => parseTdxQuote(raw.toString('hex')), /DEBUG/);
  raw[168] = 0; raw.writeUInt16LE(5, 0);
  assert.throws(() => parseTdxQuote(raw.toString('hex')), /UNSUPPORTED/);
  raw.writeUInt16LE(4, 0);
  assert.throws(() => parseTdxQuote(raw.toString('hex') + 'a'), /INVALID_ATTESTATION_HEX/);
});
test('omitted runtime digests are recomputed and still bound to the signed RTMR3', () => {
  const expected = {...challenge(), dockerCompose: 'expected compose'};
  const context = {version: 'flashfirm-phala-context/v1', nonce: expected.nonce, taskDigest: expected.taskDigest,
    expiresAt: expected.expiresAt, signingPublicKey, encryptionPublicKey};
  const bundle = {context, ...fakeEvidence(requestReportData(context))};
  const hardware = fakeHardware(bundle), events = JSON.parse(bundle.attestation.event_log);
  for (const event of events) event.digest = '';
  bundle.attestation.event_log = JSON.stringify(events);
  assert.equal(verifyPhalaEvidence(bundle, expected, hardware, now).eventPayloadsAndRtmr3Verified, true);
  events[2].event_payload = '00'.repeat(32);
  bundle.attestation.event_log = JSON.stringify(events);
  assert.throws(() => verifyPhalaEvidence(bundle, expected, hardware, now), /RTMR3_MISMATCH/);
});
test('quote padding is bounded and API identifiers need exact independently downloaded bytes', () => {
  const expected = {...challenge(), dockerCompose: 'expected compose'};
  const context = {version: 'flashfirm-phala-context/v1', nonce: expected.nonce, taskDigest: expected.taskDigest,
    expiresAt: expected.expiresAt, signingPublicKey, encryptionPublicKey};
  const bundle = {context, ...fakeEvidence(requestReportData(context))};
  const original = bundle.attestation.quote;
  bundle.attestation.quote += '00'.repeat(70);
  assert.equal(parseTdxQuote(bundle.attestation.quote).zeroPaddingBytes, 70);
  assert.throws(() => parseTdxQuote(original + '00'.repeat(69) + '01'), /UNSUPPORTED/);
  assert.throws(() => parseTdxQuote(original + '00'.repeat(257)), /UNSUPPORTED/);
  assert.throws(() => parseTdxQuote(original.slice(0, -2)), /UNSUPPORTED/);
  const hardware = {...fakeHardware(bundle), checksum: 'ef'.repeat(32)};
  assert.throws(() => verifyPhalaEvidence(bundle, expected, hardware, now), /HARDWARE/);
  const downloaded = Buffer.from(bundle.attestation.quote, 'hex');
  const result = verifyPhalaEvidence(bundle, expected, hardware, now, downloaded);
  assert.equal(result.rawQuoteBinding, 'EXACT_OFFICIAL_RAW_DOWNLOAD');
  assert.equal(result.checksum, createHash('sha256').update(downloaded).digest('hex'));
  downloaded[downloaded.length - 1] = 1;
  assert.throws(() => verifyPhalaEvidence(bundle, expected, hardware, now, downloaded), /HARDWARE/);
  const mismatch = structuredClone(hardware); mismatch.quote.body.reportdata = '00'.repeat(64);
  assert.throws(() => verifyPhalaEvidence(bundle, expected, mismatch, now,
    Buffer.from(bundle.attestation.quote, 'hex')), /VERIFIER_QUOTE_MISMATCH/);
});
test('standalone HTTP worker enforces routes and exchanges encrypted task/results without returning keys', async () => {
  const server = workerServer(createWorker({now: () => now, rpc: async () => ({testOnly: true})}));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const request = (route, body) => fetch(endpoint + route, {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    assert.equal((await fetch(endpoint + '/health')).status, 200);
    assert.equal((await request('/run-secret-command', {})).status, 404);
    const attestationResponse = await request('/attest', challenge());
    assert.equal(attestationResponse.status, 200);
    const attestation = await attestationResponse.json();
    assert.equal(JSON.stringify(attestation).includes('privateKey'), false);
    const client = prepareEncryptedTask(attestation, task);
    const result = await request('/run', client.request);
    assert.equal(result.status, 200);
    assert.equal(client.decrypt(await result.json()).result.status, 'PASS');
    assert.equal((await request('/run', client.request)).status, 400);
    assert.equal((await request('/attest', {nonce: 'bad'})).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

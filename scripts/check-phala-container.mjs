// Test the actual published-image candidate with a deliberately fake host RPC.
// This is a container integration test, never a claim of real TEE evidence.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {digest, prepareEncryptedTask, requestReportData} from '../tee/phala-worker.mjs';

const execute = promisify(execFile);
const image = process.argv[2];
if (!image || !/^ghcr\.io\/0xcaptain888\/flashfirm-phala-quotation:sha-[a-f0-9]{40}$/.test(image)) {
  throw Error('EXACT_BUILD_TAG_REQUIRED');
}
const directory = await mkdtemp(join(tmpdir(), 'flashfirm-container-smoke-'));
const socket = join(directory, 'dstack.sock');
const name = 'flashfirm-phala-smoke-' + randomBytes(8).toString('hex');
const reportData = [];
const rpc = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/GetQuote') {
    reportData.push(body.report_data);
    response.end(JSON.stringify({quote: 'TEST_ONLY_NOT_HARDWARE_EVIDENCE'}));
  } else if (request.url === '/Info') {
    response.end(JSON.stringify({testOnly: true}));
  } else {
    response.writeHead(404); response.end('{}');
  }
});
await new Promise((resolve, reject) => {
  rpc.once('error', reject); rpc.listen(socket, resolve);
});
try {
  // The host runner owns this empty fixture directory/socket. Container root
  // has no DAC-override capability, so explicitly permit access to this fake
  // RPC only. Production socket permissions are neither read nor changed.
  await chmod(directory, 0o755);
  await chmod(socket, 0o666);
  await execute('docker', ['run', '-d', '--name', name, '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=64',
    '--memory=512m', '--log-driver=none', '--restart=no',
    '--mount', `type=bind,src=${socket},dst=/var/run/dstack.sock,readonly`,
    '-p', '127.0.0.1::3000', image]);
  const {stdout} = await execute('docker', ['port', name, '3000/tcp']);
  assert.match(stdout.trim(), /^127\.0\.0\.1:\d+$/);
  const endpoint = 'http://' + stdout.trim();
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(endpoint + '/health', {signal: AbortSignal.timeout(1500)});
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.service, 'flashfirm-phala-quotation/v1');
        assert.equal(health.paidModelCalls, false);
        healthy = true; break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(healthy, true, 'Container did not become healthy');
  const source = 'The published container checks exact quotations against pinned public sources.';
  const task = {version: 'flashfirm-quotation-task/v1',
    sources: [{id: 'public', text: source, sha256: digest(source)}],
    claims: [{id: 'valid', sourceId: 'public', quote: source},
      {id: 'invented', sourceId: 'public', quote: 'Unsupported made up content must be challenged.'}]};
  const post = (route, value) => fetch(endpoint + route, {method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value),
    signal: AbortSignal.timeout(5000)});
  const challenge = {nonce: randomBytes(32).toString('hex'),
    taskDigest: digest(task), expiresAt: Date.now() + 120000};
  const attestationResponse = await post('/attest', challenge);
  assert.equal(attestationResponse.status, 200);
  const bundle = await attestationResponse.json();
  assert.equal(bundle.attestation.quote, 'TEST_ONLY_NOT_HARDWARE_EVIDENCE');
  assert.deepEqual(reportData, [requestReportData(bundle.context)]);
  assert.equal(JSON.stringify(bundle).includes('privateKey'), false);
  const client = prepareEncryptedTask(bundle, task);
  const result = await post('/run', client.request);
  assert.equal(result.status, 200);
  const decrypted = client.decrypt(await result.json());
  assert.equal(decrypted.result.status, 'CHALLENGED');
  assert.equal(decrypted.result.claims[0].status, 'EXACT_QUOTATION');
  assert.equal(decrypted.result.claims[1].status, 'UNSUPPORTED_QUOTATION');
  assert.equal((await post('/run', client.request)).status, 400);
  assert.equal((await post('/attest', challenge)).status, 400);
  assert.equal((await post('/attest', {nonce: 'malformed'})).status, 400);
  assert.equal((await post('/execute-command', {})).status, 404);
  const copied = await execute('docker', ['exec', name, 'cat', '/app/phala-worker.mjs']);
  const {readFile} = await import('node:fs/promises');
  assert.equal(copied.stdout, await readFile('tee/phala-worker.mjs', 'utf8'));
  console.log(JSON.stringify({status: 'CONTAINER_INTEGRATION_PASSED',
    exactSourceInImage: true, encryptedTaskAndResult: true, replayRejected: true,
    rpc: 'FAKE_UNIX_SOCKET_TEST_ONLY', realHardwareEvidenceObtained: false,
    image, sourceSha256: digest(copied.stdout)}));
} finally {
  // Only the uniquely named disposable test container and its own temp folder.
  await execute('docker', ['rm', '-f', name]).catch(() => {});
  await new Promise(resolve => rpc.close(resolve));
  await rm(directory, {recursive: true, force: true});
}

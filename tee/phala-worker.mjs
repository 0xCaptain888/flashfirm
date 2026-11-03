// This entire dependency-free module is embedded in the measured Compose file.
// It checks exact source quotations, not semantic entailment or remote AI execution.
import {
  createHash, generateKeyPairSync, randomBytes, diffieHellman, hkdfSync,
  createPublicKey, createCipheriv, createDecipheriv, sign, verify,
} from 'node:crypto';
import http from 'node:http';
import {pathToFileURL} from 'node:url';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}
function publicDer(key) { return key.export({type: 'spki', format: 'der'}).toString('base64'); }
function readPublic(encoded, type) {
  if (typeof encoded !== 'string' || encoded.length > 128) throw Error('INVALID_PUBLIC_KEY');
  const key = createPublicKey({key: Buffer.from(encoded, 'base64'), type: 'spki', format: 'der'});
  if (key.asymmetricKeyType !== type || publicDer(key) !== encoded) throw Error('INVALID_PUBLIC_KEY');
  return key;
}
function sessionKey(privateKey, peerPublic, context) {
  return Buffer.from(hkdfSync('sha256', diffieHellman({privateKey, publicKey: readPublic(peerPublic, 'x25519')}),
    Buffer.from(context.nonce, 'hex'), Buffer.from('flashfirm-phala-envelope/v1:' + digest(context)), 32));
}
export function seal(value, key, context, direction) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(canonical({context, direction})));
  const bytes = Buffer.concat([cipher.update(canonical(value), 'utf8'), cipher.final()]);
  return {iv: iv.toString('base64'), ciphertext: bytes.toString('base64'), tag: cipher.getAuthTag().toString('base64')};
}
export function open(envelope, key, context, direction) {
  if (!envelope || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 262144) throw Error('INVALID_ENVELOPE');
  const iv = Buffer.from(envelope.iv ?? '', 'base64'), tag = Buffer.from(envelope.tag ?? '', 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw Error('INVALID_ENVELOPE');
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(canonical({context, direction}))); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]).toString('utf8'));
}
export function quotationGate(task) {
  if (!task || task.version !== 'flashfirm-quotation-task/v1' || !Array.isArray(task.sources) ||
    task.sources.length < 1 || task.sources.length > 8 || !Array.isArray(task.claims) ||
    task.claims.length < 1 || task.claims.length > 32) throw Error('INVALID_TASK');
  const sources = new Map();
  for (const source of task.sources) {
    if (!source || typeof source.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(source.id) ||
      sources.has(source.id) || typeof source.text !== 'string' || source.text.length > 50000 ||
      !/^[a-f0-9]{64}$/.test(source.sha256) || digest(source.text) !== source.sha256) throw Error('INVALID_SOURCE');
    sources.set(source.id, source);
  }
  const ids = new Set();
  const claims = task.claims.map(claim => {
    if (!claim || typeof claim.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(claim.id) ||
      ids.has(claim.id) || typeof claim.quote !== 'string' || claim.quote.length > 2000) throw Error('INVALID_CLAIM');
    ids.add(claim.id);
    const source = sources.get(claim.sourceId);
    const supported = !!source && claim.quote.trim().length >= 12 && source.text.includes(claim.quote);
    return {id: claim.id, sourceId: claim.sourceId ?? null, sourceSha256: source?.sha256 ?? null,
      status: supported ? 'EXACT_QUOTATION' : 'UNSUPPORTED_QUOTATION'};
  });
  return {version: 'flashfirm-quotation-result/v1', taskDigest: digest(task),
    status: claims.every(c => c.status === 'EXACT_QUOTATION') ? 'PASS' : 'CHALLENGED', claims,
    scope: 'Exact quotations against client-pinned source bytes; no semantic, source-authority, independent-human or AI-inference attestation'};
}
export function requestReportData(context) {
  return digest({domain: 'flashfirm-phala-attestation/v1', context}).padEnd(128, '0');
}
export function prepareEncryptedTask(attestation, task) {
  const context = attestation.context;
  if (digest(task) !== context.taskDigest) throw Error('TASK_BINDING_MISMATCH');
  const client = generateKeyPairSync('x25519');
  const key = sessionKey(client.privateKey, context.encryptionPublicKey, context);
  return {request: {nonce: context.nonce, publicKey: publicDer(client.publicKey), ...seal(task, key, context, 'request')},
    decrypt(response) {
      const signed = open(response, key, context, 'response');
      if (canonical(signed.context) !== canonical(context) || digest(signed.result) !== signed.resultDigest ||
        signed.result?.taskDigest !== context.taskDigest ||
        !verify(null, Buffer.from(canonical({context, result: signed.result, resultDigest: signed.resultDigest})),
          readPublic(context.signingPublicKey, 'ed25519'), Buffer.from(signed.signature ?? '', 'base64'))) throw Error('RESULT_SIGNATURE_OR_BINDING_MISMATCH');
      // Reproduce the cheap deterministic gate independently; attestation is not a substitute for checking output.
      if (canonical(signed.result) !== canonical(quotationGate(task))) throw Error('RESULT_CONTENT_MISMATCH');
      return signed;
    }};
}
export async function dstackRpc(method, data) {
  if (!['GetQuote', 'Info'].includes(method)) throw Error('DSTACK_METHOD_NOT_ALLOWED');
  return new Promise((resolve, reject) => {
    const request = http.request({socketPath: '/var/run/dstack.sock', path: '/' + method, method: 'POST',
      headers: {'Content-Type': 'application/json'}}, response => {
      let bytes = 0, body = '';
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2097152) { response.destroy(); reject(Error('DSTACK_RESPONSE_TOO_LARGE')); }
        else body += chunk;
      });
      response.on('error', reject);
      response.on('end', () => {
        try { if (response.statusCode !== 200) throw Error('DSTACK_RPC_FAILED'); resolve(JSON.parse(body)); }
        catch (error) { reject(error); }
      });
    });
    request.setTimeout(20000, () => request.destroy(Error('DSTACK_TIMEOUT')));
    request.on('error', reject); request.end(JSON.stringify(data));
  });
}
export function createWorker({rpc = dstackRpc, now = Date.now} = {}) {
  const signing = generateKeyPairSync('ed25519'), encryption = generateKeyPairSync('x25519');
  const sessions = new Map(), seen = new Set();
  const started = now();
  let attestations = 0, executions = 0;
  return {
    health() { return {service: 'flashfirm-phala-quotation/v1', hardwareEvidenceRequired: true, paidModelCalls: false}; },
    async attest(request) {
      if (!request || !/^[a-f0-9]{64}$/.test(request.nonce ?? '') || !/^[a-f0-9]{64}$/.test(request.taskDigest ?? '') ||
        !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now() ||
        request.expiresAt > now() + 300000) throw Error('INVALID_CHALLENGE');
      if (now() - started > 3600000 || ++attestations > 32 || seen.has(request.nonce)) throw Error('CHALLENGE_LIMIT_OR_REPLAY');
      for (const [nonce, session] of sessions) if (session.expiresAt <= now()) sessions.delete(nonce);
      if (sessions.size >= 8) throw Error('SESSION_LIMIT');
      seen.add(request.nonce);
      const context = {version: 'flashfirm-phala-context/v1', ...request,
        signingPublicKey: publicDer(signing.publicKey), encryptionPublicKey: publicDer(encryption.publicKey)};
      // Whitelist fields: do not allow caller-supplied keys to override the binding context.
      for (const key of Object.keys(request)) if (!['nonce', 'taskDigest', 'expiresAt'].includes(key)) throw Error('INVALID_CHALLENGE');
      const [attestation, info] = await Promise.all([
        rpc('GetQuote', {report_data: requestReportData(context)}), rpc('Info', {}),
      ]);
      sessions.set(context.nonce, context);
      return {context, attestation, info};
    },
    run(request) {
      const context = sessions.get(request?.nonce);
      if (!context || context.expiresAt <= now() || now() - started > 3600000 || executions >= 8) throw Error('SESSION_EXPIRED_OR_USED');
      // Consume before decryption; a failed ciphertext never grants a second attempt.
      sessions.delete(request.nonce); executions++;
      const key = sessionKey(encryption.privateKey, request.publicKey, context);
      const task = open(request, key, context, 'request');
      if (digest(task) !== context.taskDigest) throw Error('TASK_BINDING_MISMATCH');
      const result = quotationGate(task), resultDigest = digest(result), payload = {context, result, resultDigest};
      const signature = sign(null, Buffer.from(canonical(payload)), signing.privateKey).toString('base64');
      return seal({...payload, signature}, key, context, 'response');
    },
  };
}
export function workerServer(worker = createWorker()) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify(worker.health())); return; }
      if (req.method !== 'POST' || !['/attest', '/run'].includes(req.url) ||
        req.headers['content-type']?.split(';')[0] !== 'application/json') { res.writeHead(404); res.end('{}'); return; }
      let size = 0, chunks = [];
      for await (const chunk of req) {
        size += chunk.length; if (size > 262144) throw Error('BODY_TOO_LARGE'); chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = req.url === '/attest' ? await worker.attest(body) : worker.run(body);
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400); res.end(JSON.stringify({error: 'REQUEST_REJECTED'}));
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.maxConnections = 16;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  workerServer().listen(3000, '0.0.0.0', () => console.log('flashfirm-phala-quotation/v1 listening'));
}

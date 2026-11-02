// Experimental Nitro verifier. No secret release until a real enclave integration
// has been provisioned and validated. This module never executes model workloads.
import { X509Certificate, verify, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const ROOT = '641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b';
export function decodeCbor(bytes) {
  const data = Buffer.from(bytes); let offset = 0, nodes = 0;
  if (data.length > 32768) throw Error('ATTESTATION_TOO_LARGE');
  function read(depth = 0) {
    if (depth > 12 || ++nodes > 1024 || offset >= data.length) throw Error('INVALID_CBOR');
    const first = data[offset++], type = first >> 5, ai = first & 31;
    if (type === 7 && ai === 22) return null;
    let size = ai;
    if (ai >= 24) {
      const width = { 24: 1, 25: 2, 26: 4, 27: 8 }[ai];
      if (!width || offset + width > data.length) throw Error('INVALID_CBOR_LENGTH');
      let integer = 0n; for (let i = 0; i < width; i++) integer = (integer << 8n) + BigInt(data[offset++]);
      if (integer > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('CBOR_INTEGER_OVERFLOW'); size = Number(integer);
    }
    if (type === 0) return size;
    if (type === 1) return -1 - size;
    if (type === 2 || type === 3) {
      if (offset + size > data.length) throw Error('TRUNCATED_CBOR');
      const value = data.subarray(offset, offset += size);
      return type === 2 ? value : new TextDecoder('utf-8', { fatal: true }).decode(value);
    }
    if (type === 6 && size === 18 && depth === 0) return read(depth + 1);
    if (size > 256) throw Error('CBOR_COLLECTION_TOO_LARGE');
    if (type === 4) return Array.from({ length: size }, () => read(depth + 1));
    if (type === 5) {
      const map = new Map();
      for (let i = 0; i < size; i++) { const key = read(depth + 1); if (!['string', 'number'].includes(typeof key) || map.has(key)) throw Error('INVALID_CBOR_KEY'); map.set(key, read(depth + 1)); }
      return map;
    }
    throw Error('UNSUPPORTED_CBOR');
  }
  const result = read(); if (offset !== data.length) throw Error('TRAILING_CBOR'); return result;
}
function cborBytes(buffer) {
  const bytes = Buffer.from(buffer), n = bytes.length;
  return Buffer.concat([n < 24 ? Buffer.from([0x40 + n]) : n < 256 ? Buffer.from([0x58, n]) : Buffer.from([0x59, n >> 8, n & 255]), bytes]);
}
export function validateNitroClaims(claims, expected, now = Date.now()) {
  if (!(claims instanceof Map) || claims.get('digest') !== 'SHA384' || typeof claims.get('module_id') !== 'string') throw Error('INVALID_NITRO_DOCUMENT');
  const timestamp = claims.get('timestamp');
  if (!Number.isSafeInteger(timestamp) || timestamp > now + 30000 || now - timestamp > 120000) throw Error('STALE_ATTESTATION');
  for (const [field, value] of [['nonce', expected.nonce], ['public_key', expected.publicKey], ['user_data', expected.taskDigest]]) {
    if (!Buffer.isBuffer(value) || !value.length || !Buffer.isBuffer(claims.get(field)) || !claims.get(field).equals(value)) throw Error('ATTESTATION_BINDING_MISMATCH');
  }
  if (expected.nonce.length !== 32 || expected.taskDigest.length !== 32) throw Error('INVALID_CHALLENGE');
  const pcrs = claims.get('pcrs');
  if (!(pcrs instanceof Map) || !expected.pcrs || ![0, 1, 2].every(index => /^[a-f0-9]{96}$/.test(expected.pcrs[index] ?? '') && !/^0+$/.test(expected.pcrs[index]))) throw Error('PINNED_PRODUCTION_MEASUREMENTS_REQUIRED');
  for (const [index, expectedHex] of Object.entries(expected.pcrs)) {
    const actual = pcrs.get(Number(index));
    if (!Buffer.isBuffer(actual) || actual.length !== 48 || actual.toString('hex') !== expectedHex || /^0+$/.test(expectedHex)) throw Error('PCR_MISMATCH');
  }
  return { timestamp, moduleId: claims.get('module_id') };
}
export async function verifyNitroAttestation(document, expected, rootPem, now = Date.now()) {
  const root = new X509Certificate(rootPem);
  if (createHash('sha256').update(root.raw).digest('hex') !== ROOT) throw Error('UNTRUSTED_NITRO_ROOT');
  const cose = decodeCbor(document);
  if (!Array.isArray(cose) || cose.length !== 4 || !Buffer.isBuffer(cose[0]) || !(cose[1] instanceof Map) || cose[1].size !== 0 || !Buffer.isBuffer(cose[2]) || !Buffer.isBuffer(cose[3]) || cose[3].length !== 96) throw Error('INVALID_COSE_SIGN1');
  const headers = decodeCbor(cose[0]);
  if (!(headers instanceof Map) || headers.size !== 1 || headers.get(1) !== -35) throw Error('ES384_REQUIRED');
  const claims = decodeCbor(cose[2]), details = validateNitroClaims(claims, expected, now);
  const certificate = claims.get('certificate'), bundle = claims.get('cabundle');
  if (!Buffer.isBuffer(certificate) || !Array.isArray(bundle) || bundle.length < 1 || bundle.length > 8 || bundle.some(cert => !Buffer.isBuffer(cert))) throw Error('INVALID_CERTIFICATE_CHAIN');
  const leaf = new X509Certificate(certificate);
  if (leaf.ca || leaf.publicKey.asymmetricKeyType !== 'ec' || leaf.publicKey.asymmetricKeyDetails?.namedCurve !== 'secp384r1') throw Error('INVALID_ATTESTATION_KEY');
  const temp = await mkdtemp(path.join(tmpdir(), 'flashfirm-attestation-'));
  try {
    await writeFile(path.join(temp, 'root.pem'), root.toString(), { mode: 0o600 });
    await writeFile(path.join(temp, 'leaf.pem'), leaf.toString(), { mode: 0o600 });
    await writeFile(path.join(temp, 'chain.pem'), bundle.map(cert => new X509Certificate(cert).toString()).join('\n'), { mode: 0o600 });
    // OpenSSL enforces certificate path constraints as well as signatures/dates.
    await execute('openssl', ['verify', '-no-CApath', '-no-CAstore', '-CAfile', path.join(temp, 'root.pem'), '-untrusted', path.join(temp, 'chain.pem'), '-verify_depth', '8', '-attime', String(Math.floor(now / 1000)), path.join(temp, 'leaf.pem')], { timeout: 10000, maxBuffer: 4000 });
  } finally { await rm(temp, { recursive: true, force: true }); }
  const structure = Buffer.concat([Buffer.from([0x84, 0x6a]), Buffer.from('Signature1'), cborBytes(cose[0]), Buffer.from([0x40]), cborBytes(cose[2])]);
  if (!verify('sha384', structure, { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, cose[3])) throw Error('INVALID_COSE_SIGNATURE');
  return { verified: true, ...details, documentHash: createHash('sha256').update(document).digest('hex'), scope: 'Nitro signature, vendor root, measurement and request binding; no workload execution or model-provider attestation implied' };
}

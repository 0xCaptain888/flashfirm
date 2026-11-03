import {createHash, createPublicKey} from 'node:crypto';
import {requestReportData} from '../tee/phala-worker.mjs';

function hex(value, size) {
  const result = typeof value === 'string' ? value.replace(/^0x/, '').toLowerCase() : '';
  if (!Number.isInteger(size) || !/^[a-f0-9]+$/.test(result) || result.length !== size * 2) throw Error('INVALID_ATTESTATION_HEX');
  return result;
}
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest();
export function parseTdxQuote(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 65536) throw Error('INVALID_TDX_QUOTE');
  const bytes = Buffer.from(hex(encoded, encoded.replace(/^0x/, '').length / 2), 'hex');
  // Quote v4, ECDSA P256, Intel TDX TD1.0 only. v5 has different framing.
  if (bytes.length < 636 || bytes.readUInt16LE(0) !== 4 || bytes.readUInt16LE(2) !== 2 ||
    bytes.readUInt32LE(4) !== 0x81 || bytes.readUInt32LE(632) !== bytes.length - 636) throw Error('UNSUPPORTED_TDX_QUOTE');
  if (bytes.readBigUInt64LE(168) & 1n) throw Error('DEBUG_TDX_REJECTED');
  const body = {};
  for (const [name, offset, size] of [['mrtd',136,48], ['rtmr0',328,48], ['rtmr1',376,48],
    ['rtmr2',424,48], ['rtmr3',472,48], ['reportdata',520,64]]) {
    body[name] = bytes.subarray(48 + offset, 48 + offset + size).toString('hex');
  }
  return {checksum: hash('sha256', bytes).toString('hex'), body};
}
export function verifyRtmr3(eventLog, expected) {
  if (typeof eventLog !== 'string' || eventLog.length > 1048576) throw Error('INVALID_EVENT_LOG');
  const events = JSON.parse(eventLog);
  if (!Array.isArray(events) || events.length > 2048) throw Error('INVALID_EVENT_LOG');
  let rtmr = Buffer.alloc(48);
  const runtime = [];
  for (const event of events) {
    if (event.imr !== 3) continue;
    if ((event.version ?? 1) !== 1 || event.event_type !== 0x08000001 ||
      typeof event.event !== 'string' || event.event.length > 256) throw Error('UNSUPPORTED_RUNTIME_EVENT');
    const payload = Buffer.from(hex(event.event_payload, (event.event_payload?.length ?? 0) / 2), 'hex');
    const type = Buffer.alloc(4); type.writeUInt32LE(event.event_type);
    const computed = hash('sha384', Buffer.concat([type, Buffer.from(':' + event.event + ':'), payload]));
    if (computed.toString('hex') !== hex(event.digest, 48)) throw Error('EVENT_PAYLOAD_DIGEST_MISMATCH');
    rtmr = hash('sha384', Buffer.concat([rtmr, computed])); runtime.push(event);
  }
  if (!runtime.length || rtmr.toString('hex') !== hex(expected, 48)) throw Error('RTMR3_MISMATCH');
  return runtime;
}
export function verifyPhalaEvidence(bundle, expected, hardwareVerification, now = Date.now()) {
  const {context, attestation, info} = bundle;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected.nonce ?? '') ||
    !/^[a-f0-9]{64}$/.test(expected.taskDigest ?? '') ||
    typeof expected.dockerCompose !== 'string' || !expected.dockerCompose.length) throw Error('EXPECTED_BINDING_REQUIRED');
  if (context?.version !== 'flashfirm-phala-context/v1' || context.nonce !== expected.nonce ||
    context.taskDigest !== expected.taskDigest || context.expiresAt !== expected.expiresAt ||
    !Number.isSafeInteger(context.expiresAt) || context.expiresAt <= now ||
    context.expiresAt > now + 300000 || typeof context.signingPublicKey !== 'string' ||
    typeof context.encryptionPublicKey !== 'string') throw Error('CHALLENGE_BINDING_MISMATCH');
  if (Object.keys(context).sort().join() !== 'encryptionPublicKey,expiresAt,nonce,signingPublicKey,taskDigest,version') throw Error('CHALLENGE_BINDING_MISMATCH');
  for (const [name, type] of [['signingPublicKey', 'ed25519'], ['encryptionPublicKey', 'x25519']]) {
    if (context[name].length > 128) throw Error('INVALID_ATTESTED_KEY');
    const key = createPublicKey({key: Buffer.from(context[name], 'base64'), type: 'spki', format: 'der'});
    if (key.asymmetricKeyType !== type || key.export({type: 'spki', format: 'der'}).toString('base64') !== context[name]) throw Error('INVALID_ATTESTED_KEY');
  }
  const parsed = parseTdxQuote(attestation?.quote);
  if (parsed.body.reportdata !== requestReportData(context)) throw Error('REPORT_DATA_MISMATCH');
  // This verifier result is obtained by the relying party from Phala over TLS.
  // A prover-supplied "verified:true" is never a valid substitute.
  if (hardwareVerification?.success !== true || hardwareVerification?.quote?.verified !== true ||
    hardwareVerification.checksum !== parsed.checksum || hardwareVerification.quote.header?.version !== 4 ||
    hardwareVerification.quote.header?.tee_type !== 'TEE_TDX') throw Error('HARDWARE_VERIFICATION_REQUIRED');
  for (const [field, value] of Object.entries(parsed.body)) {
    if (hex(hardwareVerification.quote.body?.[field], value.length / 2) !== value) throw Error('VERIFIER_QUOTE_MISMATCH');
  }
  const events = verifyRtmr3(attestation.event_log, parsed.body.rtmr3);
  const tcb = typeof info?.tcb_info === 'string' ? JSON.parse(info.tcb_info) : info?.tcb_info;
  const appCompose = tcb?.app_compose;
  if (typeof appCompose !== 'string' || appCompose.length > 262144) throw Error('APP_COMPOSE_REQUIRED');
  const composeHash = hash('sha256', Buffer.from(appCompose)).toString('hex');
  const composeEvents = events.filter(event => event.event === 'compose-hash');
  if (composeEvents.length !== 1 || hex(composeEvents[0].event_payload, 32) !== composeHash) throw Error('COMPOSE_HASH_MISMATCH');
  const config = JSON.parse(appCompose);
  if (config.docker_compose_file !== expected.dockerCompose) throw Error('UNEXPECTED_WORKLOAD');
  if (config.pre_launch_script || config.public_logs === true || config.public_sysinfo === true) throw Error('UNSAFE_APP_CONFIGURATION');
  const appEvents = events.filter(event => event.event === 'app-id');
  if (appEvents.length !== 1 || (expected.appId && appEvents[0].event_payload !== expected.appId)) throw Error('APP_ID_MISMATCH');
  return {hardwareSignatureVerifiedVia: 'Phala Cloud verification API over TLS; not a local DCAP verifier',
    checksum: parsed.checksum, requestBound: true, eventPayloadsAndRtmr3Verified: true,
    expectedWorkloadVerified: true, composeHash, appId: appEvents[0].event_payload,
    platformMeasurementsIndependentlyVerified: false, kmsAndGovernanceVerified: false,
    secretReleaseAllowed: false, remoteModelInferenceAttested: false,
    scope: 'Public-task hardware/application verification; platform OS/KMS/governance review remains required before confidential production use'};
}

import { createPublicKey, verify } from 'node:crypto';
import { canonical, validSeal, hash } from './protocol.mjs';
import { nearRpc } from './near-rpc.mjs';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeNearKey(value) {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value ?? '')) throw Error('ED25519_NEAR_KEY_REQUIRED');
  const encoded = value.slice(8); let number = 0n;
  for (const character of encoded) number = number * 58n + BigInt(alphabet.indexOf(character));
  const digits = [];
  while (number) { digits.unshift(Number(number & 255n)); number >>= 8n; }
  const raw = Buffer.concat([Buffer.alloc(encoded.match(/^1*/)[0].length), Buffer.from(digits)]);
  if (raw.length !== 32) throw Error('INVALID_NEAR_KEY_LENGTH');
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
}
// Both signatures cover a domain-separated, expiring challenge. Only the pinned
// account's full-access public key may bind an independent report signing key.
// This proves key control, never real-world independence or report quality.
export async function verifyReviewerBinding(envelope, expected, rpc = nearRpc, now = Date.now()) {
  const p = envelope?.reviewerSeal?.payload;
  if (!p || p.version !== 'flashfirm-reviewer-binding/1' || p.network !== 'testnet' ||
      !/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/.test(p.accountId ?? '') || p.accountId.length > 64 ||
      !/^[a-f0-9]{64}$/.test(p.nonce ?? '') || !/^[a-f0-9]{64}$/.test(p.policyHash ?? '') ||
      !Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt) || p.issuedAt > now ||
      p.expiresAt <= now || p.expiresAt - p.issuedAt > 300000 ||
      ['accountId', 'reviewerKey', 'nonce', 'policyHash', 'audience'].some(key => p[key] !== expected[key]) ||
      typeof p.audience !== 'string' || !p.audience.startsWith('https://')) throw Error('INVALID_BINDING_CHALLENGE');
  if (!validSeal(envelope.reviewerSeal, expected.reviewerKey)) throw Error('INVALID_REVIEWER_SIGNATURE');
  const signature = Buffer.from(envelope.nearSignature ?? '', 'base64');
  if (signature.length !== 64 || !verify(null, Buffer.from(canonical(p)), decodeNearKey(p.nearPublicKey), signature)) throw Error('INVALID_ACCOUNT_SIGNATURE');
  const control=await verifyReviewerAccount(p,rpc,now);
  return { verified: true, bindingHash: hash(envelope), accountId: p.accountId, nearPublicKey:p.nearPublicKey, reviewerKey: p.reviewerKey, policyHash: p.policyHash, expiresAt: p.expiresAt, blockHash: control.blockHash, independentOperatorVerified: false };
}
export async function verifyReviewerAccount(p,rpc=nearRpc,now=Date.now()) {
  if(!/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/.test(p.accountId??'')||p.accountId.length>64)throw Error('INVALID_TESTNET_ACCOUNT');
  decodeNearKey(p.nearPublicKey);
  if ((await rpc('status', [])).chain_id !== 'testnet') throw Error('WRONG_NETWORK');
  const block = await rpc('block', { finality: 'final' });
  const timestamp = Number(BigInt(block.header.timestamp_nanosec) / 1000000n);
  if (Math.abs(now - timestamp) > 120000) throw Error('STALE_ACCOUNT_PROOF');
  const keys = await rpc('query', { request_type: 'view_access_key_list', block_id: block.header.hash, account_id: p.accountId });
  if (keys.block_hash !== block.header.hash || !keys.keys?.some(key => key.public_key === p.nearPublicKey && key.access_key.permission === 'FullAccess')) throw Error('ACCOUNT_KEY_NOT_AUTHORIZED');
  return {accountKeyPresent:true,blockHash:block.header.hash,checkedAt:now,independentOperatorVerified:false};
}

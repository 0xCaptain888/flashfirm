import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { canonical, seal } from './protocol.mjs';
import { decodeNearKey } from './reviewer-binding.mjs';

// Offline, domain-separated proof only. Never creates an account/access key,
// signs a transaction, contacts a provider, or exports private key material.
export function signReviewerChallenge(challenge, expected, reviewerPem, accountPem, now = Date.now()) {
  const fields=['accountId','audience','expiresAt','issuedAt','network','nonce','policyHash','reviewerKey','version'];
  if (!challenge || Object.keys(challenge).sort().join() !== fields.sort().join() ||
      challenge.version !== 'flashfirm-reviewer-binding/1' || challenge.network !== 'testnet' ||
      !/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/.test(challenge.accountId ?? '') || challenge.accountId.length > 64 ||
      !/^[a-f0-9]{64}$/.test(challenge.nonce ?? '') || !/^[a-f0-9]{64}$/.test(challenge.policyHash ?? '') ||
      !Number.isSafeInteger(challenge.issuedAt) || !Number.isSafeInteger(challenge.expiresAt) ||
      challenge.issuedAt > now || challenge.expiresAt <= now || challenge.expiresAt - challenge.issuedAt > 300000 ||
      ['accountId','audience','policyHash'].some(key => !expected?.[key] || challenge[key] !== expected[key])) throw Error('UNTRUSTED_CHALLENGE');
  const audience = new URL(challenge.audience);
  if (audience.protocol !== 'https:' || audience.username || audience.password || audience.origin !== challenge.audience) throw Error('INVALID_AUDIENCE');
  const reviewerPrivate = createPrivateKey(reviewerPem), accountPrivate = createPrivateKey(accountPem);
  if ([reviewerPrivate,accountPrivate].some(key => key.asymmetricKeyType !== 'ed25519')) throw Error('ED25519_REQUIRED');
  const reviewerKey = createPublicKey(reviewerPrivate).export({type:'spki',format:'pem'});
  if (reviewerKey !== challenge.reviewerKey) throw Error('REVIEWER_KEY_MISMATCH');
  const nearPublic = decodeNearKey(expected.nearPublicKey).export({type:'spki',format:'der'});
  if (!nearPublic.equals(createPublicKey(accountPrivate).export({type:'spki',format:'der'}))) throw Error('ACCOUNT_KEY_MISMATCH');
  const payload = {...challenge,nearPublicKey:expected.nearPublicKey};
  return {reviewerSeal:seal(payload,{publicKey:reviewerKey,privateKey:reviewerPrivate}),nearSignature:sign(null,Buffer.from(canonical(payload)),accountPrivate).toString('base64')};
}

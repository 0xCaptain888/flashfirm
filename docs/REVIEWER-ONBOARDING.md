# Independent reviewer onboarding

This workflow proves control of an existing NEAR **testnet** account and a report-signing key. It does not establish that reviewers are different people, assess expertise, approve a report, or authorize settlement. Recruit and check independent operators separately. No real independent reviewer has completed this workflow yet.

## Coordinator

Use the authenticated SDK on a trusted machine. Never send the workspace bearer token to the reviewer or include it in GitHub Pages.

```js
const challenge = await client.reviewerChallenge({
  accountId: 'reviewer.testnet',
  reviewerKey: reviewerPublicPem,
  policyHash: committedPolicyHash
});
// Export the returned public object as challenge.json for the reviewer.
```

Challenges expire after five minutes and can be consumed only once. The account and policy binding cannot be overwritten. Independently communicate the exact public backend origin, testnet account and committed policy hash to the reviewer. For local development the audience is `https://flashfirm.local`; this is a signing identifier, not a deployed website.

## Reviewer: existing local development keys only

The offline tool supports existing Ed25519 PKCS8 PEM key files on the reviewer's own machine. It is not a Meteor wallet adapter. **Do not export a wallet seed/private key, add a Full Access Key, or share any private key to use this tool.** If your key exists only in a wallet extension, this CLI flow is not available; wallet-native compatible message signing remains separate work.

Create `expected.json` yourself from independently checked values, not by copying all fields from an untrusted challenge:

```json
{
  "accountId": "reviewer.testnet",
  "audience": "https://your-public-backend.example",
  "policyHash": "<64 lowercase hex characters of the committed policy hash>",
  "nearPublicKey": "ed25519:<existing account public key>"
}
```

The NEAR public key must already appear in that account's full-access key list; the verifier only reads that list. The tool requires private key files with no group/other permissions and refuses to overwrite a response file.

```sh
FLASHFIRM_REVIEWER_KEY_FILE=/secure/reviewer.pem \
FLASHFIRM_ACCOUNT_KEY_FILE=/secure/existing-testnet-account.pem \
node scripts/sign-reviewer-challenge.mjs challenge.json expected.json response.json
```

Return only `response.json` to the coordinator. It contains public keys and two signatures over a domain-separated challenge. No network call or transaction is made by the signing tool.

## Coordinator: verify and persist

```js
const binding = await client.bindReviewer(response);
const registered = await client.reviewerBindings();
```

The server verifies both signatures and membership of the public account key at one fresh finalized testnet block before consuming the challenge atomically. If submission times out, call `reviewerBindings()` first; do not automatically retry. Compare the account, policy hash and reviewer public key with the intended registration. If absent, inspect the error and expiry before requesting a new challenge.

The registry records point-in-time account control, not perpetual authorization. Key rotation/revocation does not automatically invalidate past evidence. Recheck account control before relying on an old binding for a new action. The registry is not yet an automatic bridge to treasury approvals.

The SDK also exposes `pinReview`, `review`, `submitDecision`, `submitAppeal`, and `resolveAppeal` for the durable review trail. These accept the existing versioned protocol envelopes; they do not synthesize reviewer signatures or execute payouts.

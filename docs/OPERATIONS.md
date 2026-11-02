# Workspace operations and integration

Requires Node >=22.13 (Node 24 recommended). The production runtime uses built-in modules only. `near-workspaces` is a development-only sandbox dependency. The server intentionally binds to loopback; public multi-user hosting is not enabled.

## Local operator

```sh
npm start
# In a separate terminal:
npm run operator:token
# Open http://127.0.0.1:43180/workspace.html
```

Read `.runtime/operator-token.txt` locally and paste into the workspace. Do not send it to another person or paste it into chat. The token lasts 24 hours; creating a replacement revokes the previous token. The browser holds it only in memory. Lock removes the in-page copy, while server-side expiry/revocation is authoritative. This is local operator authentication, not production SSO or wallet authentication.

## Persistent backend

- SQLite WAL transactions and bounded per-workspace document/job counts.
- Tenant ownership checked on all workspace reads/writes; 120 authenticated requests per owner per minute.
- AES-256-GCM encrypted document and queued-input storage; AAD binds workspace and record IDs.
- `.runtime/vault.key` is a local 0600 key; directory permissions are 0700. Losing it loses access to encrypted data. A host administrator can read it: **this is not TEE**.
- Verification jobs are idempotent per workspace/request key. Reusing a key with different input is rejected.
- A 30-second lease, three-attempt ceiling and fenced completion allow crash recovery without stale workers overwriting new results.
- Only receipt-verification jobs are enabled. Background model calls, arbitrary shell commands and payouts are not enabled.
- Workspace closure cancels queued/running work and removes active document records. Audit metadata stays. SQLite pages, WAL files and backups are not certified erased; no on-chain refund/key revocation is implied.
- Model budget reservations are separate and survive workspace closure.

## SDK

```js
import { FlashFirmClient } from './src/client.mjs';
const client = new FlashFirmClient({
  baseUrl: 'http://127.0.0.1:43180',
  token: process.env.FLASHFIRM_OPERATOR_TOKEN
});
const firm = await client.create('Technical review');
const job = await client.verifyReceipt(firm.id, signedReceipt, 'review-v1');
const status = await client.job(firm.id, job.id);
```

Requests time out after 15 seconds. The SDK never automatically repeats a write. Preserve the same idempotency key when retrying a verification submission. `SUCCEEDED` means the verifier completed; inspect `result.valid` to determine whether the receipt passed.

## Signed offers, review and scoring

Authenticated `POST /api/workspaces/evaluate` supports `COMMIT_POLICY`, `SELECT_TEAM`, `REVIEW`, `APPEAL`, and `SCORE`; see `src/governance.mjs`, `src/contribution.mjs` and their tests for the versioned envelope schemas.

The evaluate endpoint is a **stateless verifier of caller-supplied commitments**, not an external identity registry or settlement permission. For persistence, `POST /api/workspaces/:id/review` pins `{policy,resultRoot}` immutably; `/decision`, `/appeal` and `/resolution` accept the corresponding signed envelopes. `GET /review` returns the decision trail. Changed policies, overwritten decisions, late submitted appeals and new decisions after an appeal are rejected. Review identities, reasons and signatures are retained as audit metadata, so do not include confidential source material in reasons. The current treasury contract does not yet enforce the JavaScript appeal policy: do not wire `RELEASE_ELIGIBLE` directly to funds.

Signed offers are selected by capability-mask dynamic programming under an integer budget. Registered capabilities are upper bounds. Multiple identities controlled by one entity are not independent suppliers.

Contribution values use leave-one-worker-out coverage of a fixed 100-point rubric, with two of three disjoint reviewer signatures required per criterion. Artifact hashes are bound to task/result/rubric. Duplicate artifacts receive zero allocation; this is conservative and can also penalize legitimate overlapping work. No paid real-world counterfactual model evaluation has been completed.

The review protocol rejects cross-task/result replay, duplicate signers and overlapping buyer/worker/reviewer/appeal keys. Challenges stop approval; timely signed appeals require the precommitted appeal key. Signatures prove possession of keys, not independence, expertise or correctness. Durable local policy registration is implemented; trusted identity onboarding and automatic transaction enforcement remain pending.

## Verification

```sh
npm test
npm run test:http                 # local server must be running
node scripts/check-workspace-http.mjs
npm ci                          # sandbox dependencies only
npm run build:contract           # Rust wasm target and recent Binaryen required
npm run test:sandbox
```

The sandbox uses disposable local-chain accounts, never a user's wallet. `evidence/sandbox.json` is recorded local-chain evidence, not testnet confirmation. The failed-transfer test deletes a disposable sandbox recipient, verifies callback credit recovery, recreates the recipient and retries successfully. `claim_for` lets anyone sponsor gas, but sends only the already-approved amount to the fixed recipient.

## External blockers

1. NEAR testnet account, wallet interaction and funded deployment; an account ID can be shared, a private key need not be sent in chat.
2. Independently operated worker/reviewer identities, signed offers and actual appeal operators.
3. TEE provider, measurement allowlist and vendor-root remote-attestation verification.
4. NEAR Intents credentials/route configuration, permitted destination addresses and end-to-end payout testing.
5. Public backend hosting, domain/TLS, production auth, backup retention, monitoring/alert delivery and deployment secrets. GitHub Pages serves public static evidence only.

These are not marked complete. Mainnet money and confidential customer data must remain out of this development build. Development-only sandbox dependencies currently report low-severity upstream advisories; production dependencies audit clean. The patched `tar` override removes the known high/critical archive advisories from this test toolchain.

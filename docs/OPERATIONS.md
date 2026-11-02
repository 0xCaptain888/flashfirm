# Workspace operations and integration

Requires Node >=22.13 (Node 24 recommended). The Node backend uses built-in modules only. The browser wallet uses pinned Wallet Selector dependencies bundled by esbuild; `near-workspaces` is a sandbox dependency. Run `npm ci` first; `npm start` builds the wallet assets before starting the server. The server defaults to loopback. Managed public binding requires an explicit HTTPS public origin and absolute persistent runtime directory; the container has passed CI, but no public backend deployment has been completed.

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
- Jobs support receipt verification and the explicitly selected `LIVE_PUBLIC_REVIEW` preset described below. Arbitrary prompts, shell commands and payouts are not enabled.
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

`client.jobs(firm.id)` returns the owner-scoped job list, including request keys, without large input/result payloads. `client.job` retrieves one result. `client.modelStatus()` returns only budget counters and a safe blocked reason; no provider secret or prompt history is returned. The workspace UI reloads job history, polls at a bounded interval, and clears private displayed data on lock/expiry. An uncertain submission retains only its idempotency key, workspace ID and SHA256 input fingerprint in session storage, so refreshing the tab does not cause an automatic second submission. Inspect existing jobs before intentionally starting another paid run.

## Bounded public-source AI jobs

`client.runPublicReview(firm.id, 'public-review-v1')` explicitly requests the approved pinned OpenZeppelin review. The API input is `{kind:"LIVE_PUBLIC_REVIEW",preset:"openzeppelin-pinned",approvedCapFen:2000}`. It accepts no customer documents, arbitrary prompt or provider override. Only an authenticated local operator may queue it.

The runner requires the existing shared policy/budget ledger and room for four calls and its computed conservative reservations (1,004 fen with the currently authorized 1,000-token policy). Per-call limits remain authoritative even if another process spends between preflight and execution. As recorded on November 2, 2026, ten of twelve authorized calls have been consumed, with 1,591 fen reserved against the cumulative 2,000-fen cap. Reservations are conservative estimates, not authoritative provider bills. A new four-call run is blocked; do not reset the ledger to bypass the limits. The real queued run completed all four calls and passed receipt integrity verification, but its quality result was CHALLENGED because a claim's quotation was absent from its pinned source. It caused no settlement. See `evidence/queued-live-receipt.json`.

Five-second heartbeats renew the 30-second lease. Before dispatching the first paid call, the queue records a persistent paid-start marker. If the lease expires thereafter, the job fails for manual inspection and is never automatically replayed. Failed/ambiguous provider reservations stay consumed. Reusing the same idempotency key returns the original job, including a failed one. Partial sources/outputs remain under `.runtime/model-jobs/<job-id>`; provider credentials and the budget ledger stay at the shared runtime root. A new key is a new job, not recovery of old spending.

Dissolution prevents subsequent provider calls and refuses stale completion. It cannot retract a request already delivered to the provider; that call may finish and still incur cost. The closed workspace's audit and partial public-source output may remain locally. A successful model job records the signed report, never an on-chain payment, and does not replace the published demonstration evidence automatically.

## Signed offers, review and scoring

Authenticated `POST /api/workspaces/evaluate` supports `COMMIT_POLICY`, `SELECT_TEAM`, `REVIEW`, `APPEAL`, and `SCORE`; see `src/governance.mjs`, `src/contribution.mjs` and their tests for the versioned envelope schemas.

The evaluate endpoint is a **stateless verifier of caller-supplied commitments**, not an external identity registry or settlement permission. For persistence, `POST /api/workspaces/:id/review` pins `{policy,resultRoot}` immutably; `/decision`, `/appeal` and `/resolution` accept the corresponding signed envelopes. `GET /review` returns the decision trail. Changed policies, overwritten decisions, late submitted appeals and new decisions after an appeal are rejected. Review identities, reasons and signatures are retained as audit metadata, so do not include confidential source material in reasons. Treasury v0.2 enforces its own native NEAR account quorum, appeal window, challenge freeze and pinned arbitration. It does not verify these JavaScript envelopes: do not wire `RELEASE_ELIGIBLE` directly to funds without an authenticated identity mapping and the actual on-chain approvals.

Signed offers are selected by capability-mask dynamic programming under an integer budget. Registered capabilities are upper bounds. Multiple identities controlled by one entity are not independent suppliers.

Contribution values use leave-one-worker-out coverage of a fixed 100-point rubric, with two of three disjoint reviewer signatures required per criterion. Artifact hashes are bound to task/result/rubric. Duplicate artifacts receive zero allocation; this is conservative and can also penalize legitimate overlapping work. No paid real-world counterfactual model evaluation has been completed.

The review protocol rejects cross-task/result replay, duplicate signers and overlapping buyer/worker/reviewer/appeal keys. Challenges stop approval; timely signed appeals require the precommitted appeal key. Signatures prove possession of keys, not independence, expertise or correctness. Durable local policy registration and a one-use, owner-scoped reviewer account-binding registry are implemented. See [reviewer onboarding](REVIEWER-ONBOARDING.md) for the SDK and offline signing workflow. Actual independent operators and automatic transaction enforcement remain pending.

## Verification

```sh
npm test
npm run test:http                 # local server must be running
node scripts/check-workspace-http.mjs
npm ci                          # pinned wallet build and sandbox dependencies
npm run build:contract           # Rust wasm target and recent Binaryen required
npm run test:sandbox
```

The sandbox uses disposable local-chain accounts, never a user's wallet. `evidence/sandbox.json` is recorded local-chain evidence, not testnet confirmation. The failed-transfer test deletes a disposable sandbox recipient, verifies callback credit recovery, recreates the recipient and retries successfully. `claim_for` lets anyone sponsor gas, but sends only the already-approved amount to the fixed recipient.

## External blockers

1. Real testnet failed-transfer callback recovery remains untested. Deployment, buyer-signed happy-path payout, disputed refund and expired-proposal refund have real testnet evidence. Failed-transfer recovery has sandbox evidence only. Do not reuse the closed buyer treasury or replay an ambiguous deployment.
2. Independently operated worker/reviewer identities, signed offers and actual appeal operators.
3. TEE hardware/provider and a real positive attestation, workload measurement allowlist, protected execution and secret release. The experimental Nitro verifier has negative tests; this is not evidence of a running enclave.
4. NEAR Intents credentials/route configuration, permitted destination addresses and end-to-end payout testing.
5. Public backend hosting, domain/TLS, production auth, off-host backup retention, monitoring/alert delivery and deployment secrets. The non-root container and encrypted backup/restore are implemented and tested; they are not a live hosting deployment. GitHub Pages serves public static evidence only.

These are not marked complete. Mainnet money and confidential customer data must remain out of this development build. The full dependency audit reports 15 low-severity advisories and no moderate/high/critical advisories at this checkpoint. Although npm labels wallet libraries as development dependencies because they are bundled at build time, their code runs in the browser; a clean `--omit=dev` audit is not a claim that the shipped frontend has no advisories. The patched `tar` override removes the known high/critical archive advisories from the sandbox toolchain.

# One task, from delivery to verified payment

This upgrade adds a durable pipeline to both the local service and Cloudflare D1.
It does not turn the historical 0.5 NEAR demonstration into payment for the AI report.
That demonstration's source and destination transaction hashes are reserved in the
global payment registry and cannot be consumed by another task.

## Protocol and API

Use `FlashFirmClient.taskFlow(workspaceId)` to download the report, claim hashes,
full/removal evaluation inputs and current pipeline. `advanceTask(id, step, input)`
calls these authenticated POST endpoints:

| Step | `/api/workspaces/:id/flow/…` input | What must pass |
|---|---|---|
| `plan` | Buyer-signed `flashfirm-task-plan/1` envelope | Exact task/report/review-policy hashes, reviewer/worker keys, artifact hashes, rubric, USDC budget, recipients and expiry |
| `quality` | `{evaluations, certificates, contributions}` | Two distinct pinned signatures, every claim, every full/removal sample, real source context and separate scores |
| `privacy` | `{proof, approval}` when required by the plan | Exact task/report/private-task commitment, fresh hardware verdict, approved measurements and signed encrypted-task result |
| `manifest` | `{}` | Appeal clearance, signed authorship claims and an external identity authority's complete unrevoked roster |
| `invoice` | Buyer-signed `flashfirm-task-invoice/1` | Immutable manifest, one worker/recipient/USDC allocation, NEAR principal and fee limit, expiry and nonce |
| `quote` | `{invoiceHash, quote}` | Official SDK signature; NEAR origin, Arbitrum native USDC, exact addresses, authorized principal, minimum output and fresh deadline |
| `verify` | `{invoiceHash, hash}` | Exact final native deposit, actual fee cap, relay linkage and independently finalized ERC-20 delivery |
| `refund` | `{invoiceHash, hash}` | Relay-linked finalized NEAR receipt bodies with the exact native refund; a REFUNDED label alone fails |

GET `/api/workspaces/:id/flow` returns the complete evaluation package. No endpoint
signs wallet transactions or broadcasts. Use the wallet's native Send interface
after separately reviewing an authorized invoice and bound quote. New mainnet
payments require the user's actual final wallet confirmation.

Plans are **post-delivery, pre-evaluation** commitments. The UI never describes
them as pre-work agreements. Changing a report requires a separate workspace.
The existing `flashfirm-dossier/1` remains a report/review export; the evaluation
package includes the additional flow records and their exact report linkage.

## Signing roles

An envelope is `{payload, publicKey, signature}` using Ed25519 and the protocol's
canonical JSON encoding. Sign with an existing **off-chain** key:

```sh
node scripts/task-envelope.mjs payload.json existing-offchain-key.pem signed.json
```

This utility neither generates reviewers nor reads wallet seed phrases.
The buyer key must match the pinned review policy. Each worker must sign
`flashfirm-contribution-claim/1` with `planHash`, `resultRoot`, `artifactHash`,
`subject`, `role:"AUTHOR"` and `issuedAt`.

Configure an independently operated Ed25519 identity authority using
`IDENTITY_AUTHORITY_KEY` (Workers secret) or `FLASHFIRM_IDENTITY_AUTHORITY_KEY`
(local environment). It must be outside the buyer/reviewer/worker key set.
Its signed `flashfirm-identity/1` certificates contain `taskRoot`, `key`,
`subject` (a pseudonymous SHA-256 identifier), `role`, `evidenceHash`, `issuedAt`
and `expiresAt`. Worker certificates additionally bind the artifact hash and
`authorshipReviewed:true`. Certificates must precede the evaluation plan.
The same subject cannot occupy multiple roles. Revoked subjects are supplied
through `REVOKED_IDENTITY_SUBJECTS` / `FLASHFIRM_REVOKED_IDENTITY_SUBJECTS`.

An authority certificate is accountable external testimony, **not proof of one
human per key**. Colluding or dishonest authorities remain a risk. No independent
authority or reviewers have been enrolled in the current deployment.

## Semantic support and contribution quality

`flashfirm-quality-evaluation/1` signs `planHash`, `resultRoot`, `issuedAt`,
`method`, `claims` and `samples`. Every claim identifies `workerId`, `claimIndex`,
`claimHash`, a verdict, an explanatory reason and exact `sourceContext`.
Unsupported, contradicted or inference verdicts keep payment challenged.
This conservative default does not automatically promote an inference to a fact.

Each sample contains `sampleHash`, per-rubric `{id,score}` values (0–100) and a
`traceHash`. Scores are recomputed on the full materials and on every coalition
with one worker removed; these are no longer inferred from coverage alone.
The mean signed quality loss determines nonnegative contribution weights.
Formatting/case-equivalent repeated claims are ineligible, and integer allocation
conserves the USDC budget, fee and refund. Paraphrase plagiarism and collusion are
still matters for independent review, not solved by normalization.

`runAblation` accepts a real evaluator adapter and invokes it once per sample.
`evaluateTaskWithModel` connects those samples to the existing budgeted model
provider, records actual call IDs/outputs, never retries a charged request and
produces an **unsigned** evaluation for a pinned reviewer to inspect and sign.

```sh
node scripts/evaluate-task.mjs /private/evaluation-package.json
```

The current cumulative model allowance remains ¥20 / 12 calls. Ten calls and
¥15.91 of conservative reservations are already consumed. A four-call evaluation
is therefore blocked before network access. Local tests use explicitly synthetic
responses; no new paid full evaluation has been represented as completed.

## What a payment proof establishes

The bridge mapping is trusted to the official signed 1Click quote and its relay
status; both chain transactions are checked using fixed read-only RPC endpoints.
This is not a bridge light-client proof. An invoice's output minimum is its
allocated USDC amount; a larger actual receipt is recorded separately.
Protocol fees/refund accounting are allocations, not claims that a fee collector
or refund was paid. Invoice totals describe worker payouts only.

Configure `SECRET_RELEASE_AUTHORITY_KEY` (Workers) or
`FLASHFIRM_SECRET_RELEASE_AUTHORITY_KEY` (local) for private quotation proof
acceptance. A plan with `privacyMode:"CONFIDENTIAL_QUOTATIONS"` must pin a
`privateTaskDigest`; its settlement manifest stays blocked until that exact proof
passes. Public plans default to `PUBLIC_SOURCES`. The proof does not certify AI
inference.

Source hash, deposit address and destination/refund hash reuse are prevented by
database uniqueness constraints and transactional optimistic concurrency. Pending
or refunded invoices never produce `WORKER_PAYOUTS_VERIFIED`. That state verifies
worker receipts only; fee collection and refund accounting are not automatically
paid, and `taskSettlementComplete` remains false. Restoration preserves replay
protection and places task flows on an operator reconciliation hold.

Refund verification supports **native NEAR** receipt actions only. The archival
RPC must expose full receipt bodies through `EXPERIMENTAL_tx_status`. Missing
bodies, wrapped-token refunds or unlinked transactions stay unverified.
No real cross-chain refund has been executed or independently captured yet.

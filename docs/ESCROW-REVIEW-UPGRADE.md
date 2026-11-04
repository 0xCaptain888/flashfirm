# Escrow, external review and confidential team execution

Updated November 4, 2026 (Asia/Shanghai).

This upgrade implements a bounded native NEAR mainnet escrow adapter, an actual
reviewer handoff and a whole-team confidential-inference runner. The public
backend keeps mainnet execution and paid model calls disabled. No new mainnet
payment, paid AI call or private live TEE run was made.

## One common budget, conserved on chain

The existing tested treasury v0.2 WASM is unchanged. A new buyer-signed
`flashfirm-native-settlement/2` envelope supports **native NEAR mainnet**, using
the same signed v2 worker, protocol-fee and unused-budget allocation weights.
It additionally requires:

```json
{
  "version": "flashfirm-native-settlement/2",
  "network": "mainnet",
  "asset": "NATIVE_NEAR",
  "requireLockedContract": true,
  "noFxConversion": true,
  "commonEscrowBudget": true
}
```

All original authorization fields remain required: exact task/report/manifest,
buyer-approved NEAR amount (at most **0.01 NEAR**, excluding account deployment
and gas), contract/configuration, WASM hash, fixed account mappings, gas sponsor,
and validity interval. Native account IDs must be `.near` names or implicit
64-character hex accounts; testnet authorization remains v1 and `.testnet` only.
The gas sponsor must be distinct from all treasury roles.

This is a separate **native NEAR agreement**, not a USD/NEAR exchange quote.
The USDC allocation determines relative weights; the separate buyer signature
approves the actual native amount and destinations. Existing cross-chain invoice
execution remains separate, and the payment route cannot be changed after it
is locked.

Mainnet acceptance requires the treasury's access-key list to be empty at the
final verification block **and at every funding, proposal, approval and payment
transaction block**, in addition to pinned bytecode and configuration. This
prevents an account key from upgrading/deleting the treasury or withdrawing its
budget. The contract has no upgrade/deletion method.

**Removing the treasury's last key is irreversible.** Deploy, initialize and
independently inspect it first. This upgrade never removes a live account key.
The deployment account's storage reserve is separate from the approved task
budget and remains in the locked contract; no storage-reserve refund is claimed.

After one buyer funding transaction, the buyer proposes the exact conserved
allocation. Two pinned account reviewers approve it, followed by the appeal
interval. A gas sponsor can then claim the fixed worker rewards, fee and
unused-budget return. Each obligation has its own transaction/callback; this is
**not one atomic all-recipient transaction**. Failed transfers restore credit in
the existing contract. A failed or ambiguous keeper send holds its durable intent
for manual reconciliation; it never retries automatically.

The verifier requires exact successful protocol Transfer bodies reachable from
the claimed transaction, fixed predecessor/receiver/amount, finalized blocks,
zero remaining credits/pending amounts and the complete paid budget. A true
callback or storage value alone is insufficient. Historical RPC receipt/code/
access-key bodies must be available; otherwise verification fails closed.

### Operator enablement and offline preparation

Local API: `FLASHFIRM_NATIVE_MAINNET_ENABLED=yes`.
Workers: `NATIVE_MAINNET_ENABLED=yes`. Both default to disabled and **were not
enabled by this upgrade**. This opt-in accepts signed authorization/evidence;
the HTTP service never loads a wallet key or sends a financial transaction.

```sh
npm run settlement:prepare -- /private/flow.json /private/new-execution-package.json
npm run settlement:keeper -- /private/flow.json /private/relayer.json /private/journal preview
```

The execution package contains exact transactions, all native amounts, verification
input slots and an **enabled:false** keeper policy. It does not generate buyer or
reviewer signatures. An actual mainnet execution additionally requires a separate
operator-approved private file binding the exact authorization, contract,
sponsor, budget, WASM, expiry, maximum call count and per-call gas:

```sh
npm run settlement:keeper -- /private/flow.json /private/relayer.json /private/journal execute /private/approved-execution-policy.json
```

The sponsor's key file must have private permissions. The keeper can only pay gas
for zero-deposit `claim_for` calls. It cannot fund, approve, create accounts or
redirect money. The original bridge FunctionCall lock is unaffected.

`flow/native-verify` uses the fixed RPC for the signed network. Mainnet financial
transaction reservations share the existing `near` namespace, preventing reuse
as invoice/refund evidence. Native treasury reservations include network.

Status distinguishes `nativeTestnetSettlementVerified`,
`nativeMainnetSettlementVerified`, `commonEscrowBudgetVerified` and
`crossChainSettlementVerified`. A complete native mainnet escrow can satisfy
`taskSettlementComplete`, but never the cross-chain flag. Expired task plans do
not erase previously verified financial facts or unlock another payment path.

## Real external review, without manufactured reviewers

Authenticated **GET** routes:

- `/api/workspaces/:id/flow/readiness`: fresh release checks, blockers and next actions.
- `/api/workspaces/:id/flow/review-package`: public-source review handoff.
- `/api/workspaces/:id/flow/execution-package`: exact authorized native preview.

SDK methods: `taskReadiness`, `reviewPackage`, `executionPackage`.
Viewer access and ownership checks still apply; these GET routes do not mutate
data or consume the write quota. The readiness checklist reruns the actual
manifest release rules, including worker signatures, external identities,
current semantic/removal evaluations and privacy requirements. It does not
certify real-world independence.

The review handoff contains the signed plan/report, pinned policy, source context,
claim commitments and each full/removal sample. It excludes payment invoices,
access tokens, identities' private files and private reports. Confidential-mode
handoff is refused; a separately approved secure review channel is still needed.

On each reviewer's machine, using their **already agreed** key:

```sh
npm run review:human -- draft /private/package.json /private/reviewer-public.pem /private/new-draft.json
# Independently fill every claim verdict/reason, sample criterion score/notes,
# and APPROVE/CHALLENGE decision. Nothing starts pre-approved.
# Compare the buyer identity and plan hash via an agreed trusted channel.
FLASHFIRM_REVIEWER_KEY_FILE=/private/reviewer-private.pem npm run review:human -- sign /private/package.json /private/completed-draft.json /private/new-response.json EXPECTED_PLAN_HASH
npm run review:human -- verify /private/package.json /private/response.json
```

The signer verifies all bindings, source context, scores and pinned identities,
requires private key permissions, and refuses to sign an APPROVE decision with
unsupported claims. It emits a signed quality evaluation and a signed decision.
Submit decisions through the existing `/decision` API and combine two actual
reviewers' evaluations with real authority certificates and worker contribution
signatures through `flow/quality`. A notes hash is an audit commitment, not proof
that someone performed the review.

### Conflicting judgments block money

The default release rule rejects:

- any criterion whose reviewers differ by more than 25 points on the 0–100 scale;
- any worker for whom reviewers disagree on the sign of the removal contribution.

A buyer can sign a stricter `evaluationPolicy` with
`version: "flashfirm-evaluation-policy/1"`, `maximumCriterionSpread: 0..25` and
`requireMarginalAgreement: true`. An unsigned client option cannot relax it.
`REVIEWER_DISAGREEMENT` prevents manifest creation. Corrected evaluations must
still come from the pinned reviewers; the coordinator cannot resolve a semantic
conflict by averaging it away. This does not solve collusion, paraphrase attacks
or semantic truth.

## Whole-team confidential execution

```sh
npm run inference:team -- preview /private/team-input.json /private/shared-runtime
npm run inference:team -- execute /private/team-input.json /private/shared-runtime /private/new-output-directory
```

Input: `{taskRoot, task, workers:[{workerId,model,approval,runtimeAudit}]}`.
Every worker must have a separate task/worker/model-bound release approval.
All share the same actual private task commitment. Existing ACI configuration
and separately configured verification authority remain mandatory.

Before the first private release/model POST, the whole team must fit the
**original** cumulative budget and call cap. Missing/corrupt ledgers, duplicate
approvals and oversize inputs fail closed. Per-call reservations still use the
shared durable lock; concurrent spend can stop a later worker and cannot exceed
the cap. No group-wide reservation or automatic paid retry is claimed. At the
current 10/12-call state, a three-worker run is correctly blocked.

`FLASHFIRM_ACI_AUDITOR_URL` can supply a fresh signed runtime audit after seeing
public attestation/session metadata. It receives no task plaintext or model
output. Each call still requires the official SDK checks and separately pinned
OS/KMS/model appraisal, followed by exact complete request/response receipts.

Each completed result/certificate is retained privately before the next worker.
A partial failure does not discard completed work or refund uncertain spend.
All certificate rows can then be submitted as one authenticated `flow/inference`
input for the exact report artifacts. The operator cannot replace the approved
verifier identity or use the existing DeepSeek gateway key as an ACI key.

The managed Node image now includes the private inference/team commands and
offline reviewer/transaction-preview tools. They require explicit invocation
with the reconciled private runtime; the server does not auto-start them. The
financial keeper remains on a separate trusted machine with its own signer and
journal, rather than mounting a wallet key into the public web container.

## Validation and remaining acceptance

`npm test` covers mainnet network/code/key locking, exact transfer bodies, replay
fences, default-off APIs, reviewer package/signing/tampering, semantic
disagreements and whole-team budget limits; all **160 tests passed**. `npm run test:locked-escrow` actually
removes the key of a **disposable LOCAL SANDBOX** treasury, then pays three
workers, protocol fee and unused budget. Synthetic review/identity fixtures are
explicit. This is not mainnet or independent human acceptance.

The [real public Workers/D1 acceptance](../evidence/release-workflow-upgrade.json)
also passed: blank reviewer handoff, exact report binding, read-only fresh
checks, release rejection without external identity, default-off mainnet,
retained evidence after closure and revoked test access. The temporary QA
workspace was closed and its token revoked. Its two reviewer responses were
synthetic; no model call or payment occurred.

Remaining: real independent participants/certification; public testnet v2 task;
reviewed and explicitly authorized mainnet deployment/funding; real private ACI
credentials/auditor/receipts; actual same-task cross-chain payment/refund;
organization identity provider, verified email sender and real device delivery.
Full Node paid execution is still separate from the free public verification
backend. The existing monetary/call caps and stopped Phala instance are unchanged.

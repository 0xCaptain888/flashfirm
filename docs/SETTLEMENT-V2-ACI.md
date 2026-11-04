# Same-task settlement v2 and confidential inference

Updated November 3, 2026.

**November 4 follow-up:** [Escrow, reviewer handoff and confidential teams](ESCROW-REVIEW-UPGRADE.md)
adds a default-off native mainnet common-budget path, mandatory keyless treasury
checks and whole-team inference preflight. The invoice-only and testnet-only
limitations below describe the earlier version. Cross-chain batching and actual
mainnet/private live acceptance remain pending.

## What is implemented and what actually ran

The authenticated local service, Workers/D1 API and SDK accept one immutable report, buyer-signed evaluation plan, signed contribution claims, externally certified identities, reviewer decisions, semantic/removal evaluations and a locked allocation manifest. Mainnet worker payments, protocol fees and unused-budget returns are separate signed obligations. The task is not marked fully settled until **every** obligation has independently verified payment evidence.

A new local NEAR sandbox test used the recorded corrected AI report and explicitly synthetic reviewer/identity certificates. It funded one treasury and actually transferred test balances to three workers, a fee collector and the buyer. Funding, proposal, two approvals and five successful transfer callbacks were checked against final RPC results. Every payout additionally required a reachable, successful protocol `Transfer` receipt from the treasury to the exact recipient for the exact amount. Before-review and repeated claims were rejected. This is local blockchain execution; it is **not** a public testnet or mainnet transaction, or independent human review.

The production service remains behind its existing identity and signature gates. No new mainnet money, paid model call, Phala restart or confidential live submission was made for this upgrade. The historical bridge transaction remains a separate demonstration.

## Allocation and payment obligations

Add this optional field to the **buyer-signed** `flashfirm-task-plan/1`:

```json
{
  "settlementPolicy": {
    "version": "flashfirm-allocation-policy/2",
    "spendUnits": 800000,
    "feeBps": 200,
    "feeRecipient": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "refundRecipient": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}
```

Amounts are integer native Arbitrum USDC allocation units (6 decimals). For a 1,000,000-unit budget with eligible contributions:

| Obligation | Allocation |
| --- | --- |
| Workers combined | 784,000 |
| Protocol fee | 16,000 |
| Unspent budget returned to buyer's signed destination | 200,000 |

Only the capped spend is fee-bearing. A worker with no eligible contribution receives zero. With no eligible workers the fee is zero and the full budget is refunded. All positive obligations have distinct fixed destinations and domain-bound IDs. The plan pins the refund destination; its real-world ownership is the buyer's responsibility.

`flow/manifest` creates `flashfirm-settlement-manifest/2`. `flow/invoice` then requires `flashfirm-task-invoice/2`, adding `obligationId`, `kind` and `workerId` (`null` for fees/refunds) to the original invoice fields. Exact amount, recipient, expiry, source, quote signature and chain evidence still apply. A fee invoice and a refund invoice cannot collide through a shared null worker ID.

Each mainnet obligation currently requires its own exact funding/quote authorization. This release does not add a mainnet escrow or authorize an unattended mainnet wallet. A verified mainnet budget-return invoice proves that particular payment, not that it came from one previously escrowed budget. Bridge route minimums and gas costs can make small individual obligations uneconomic; do not relabel the native testnet adapter as a batched mainnet solution.

## Native NEAR execution adapter

`flow/native` accepts a separate buyer-signed `flashfirm-native-settlement/1` envelope binding:

- `taskRoot`, `resultRoot`, `manifestHash`, `issuedAt`, `expiresAt`;
- `network: "testnet"`, `relayer`, `nativeBudgetYocto` (maximum 0.01 NEAR);
- `wasmSha256`, pinned to the tested existing treasury artifact;
- `config`: the exact testnet contract, buyer, three reviewers, arbiter, recipients, deadlines and policy hash;
- `accounts`: one `{obligationId, accountId}` mapping per obligation. The unused-budget refund must map to the buyer.

Largest-remainder integer allocation converts the **signed weights** into the independently approved native budget. This is not a USDC/NEAR FX quote. The exact yocto amounts, report-bound evidence root and Rust-compatible plan hash are available from `validateNativeSettlement`.

A task locks either native execution or mainnet invoices. The treasury account is globally reserved to prevent reuse across tasks. No HTTP body may choose a different RPC URL. Readback is anchored to a finalized block and the pinned tested bytecode; successful final claim callbacks **and exact protocol Transfer receipt bodies** are required for every recipient. Bodies must be reachable through that transaction's receipt tree, with the treasury as predecessor, the fixed destination and its exact yocto amount. Storage values and a `true` callback alone are insufficient, including if the account operator temporarily replaced its code. If the fixed RPC does not expose historical full bodies through `EXPERIMENTAL_tx_status`, verification fails closed.

After buyer funding/proposal, two on-chain approvals and the appeal interval:

```sh
npm run settlement:keeper -- /private/flow.json /private/testnet-relayer-key.json /private/new-journal preview
npm run settlement:keeper -- /private/flow.json /private/testnet-relayer-key.json /private/new-journal execute
```

The existing treasury account must already be deployed and initialized. The testnet relayer pays gas only. It can send zero-deposit `claim_for` calls to fixed recipients, never fund, approve, redirect or touch mainnet. Before **each** dispatch it rechecks finalized code/configuration and writes an exclusive durable intent. An ambiguous send or failed callback is held for reconciliation, not automatically retried.

Submit `{fund, propose, approvals:[{accountId,hash}], claims:[{recipient,hash}]}` to `flow/native-verify`. Only fixed testnet RPC checks can set `nativeTestnetSettlementVerified`. All transaction hashes are globally reserved. This flag is distinct from `taskSettlementComplete`, which describes full mainnet invoice settlement.

The underlying v0.2 contract, WASM and historical evidence remain unchanged. Existing sandbox failure-callback tests continue to verify restored credit followed by a reconciled retry.

## Confidential inference

The Node-only adapter uses pinned `@phala/aci-verifier` 0.11.0 and a fixed `https://inference.phala.com/v1` endpoint. It:

1. Verifies a separately signed, task/worker/model-bound release approval.
2. Establishes an official SDK hardware-verified connection with reviewed compose hashes and fixed upstream session IDs.
3. Requires a separate signed OS/KMS/model-runtime audit tied to the **same gateway evidence, keyset and session**. A configured auditor can appraise the fresh public report before private material is released.
4. Checks upstream session content/evidence hashes and expiry using the official SDK.
5. Reserves spend in the existing cumulative provider ledger **before** its only inference POST. No auto-retry or fresh allowance is introduced.
6. Sends the exact canonical task input with a fresh per-request nonce through the SDK's SPKI-pinned transport.
7. Fully consumes the response and requires passing receipt signature, request/response body hashes and pinned upstream-session checks. Required `skip` results are rejected.
8. Returns the output privately and emits task/worker/input/output commitments. The configured inference verifier signs a certificate for API acceptance.

The SDK explicitly does **not** reconstruct the full dstack boot/KMS chain or deeply appraise upstream model evidence. Its deprecated production-OS option is ignored. This adapter therefore requires an independently signed external appraisal for those gaps. A model label, provider `verified:true`, self-issued operator certificate, or an upstream evidence hash alone is insufficient. Trusted inference here remains conditional on the configured audit authority and its actual appraisal quality; it is not a cryptographic proof of arbitrary model computation.

### Required private configuration

- A real Phala ACI API key in `PHALA_ACI_API_KEY`. The existing DeepSeek gateway credential is not interchangeable.
- `FLASHFIRM_SECRET_RELEASE_AUTHORITY_KEY`: externally managed public approval/audit key.
- `FLASHFIRM_INFERENCE_VERIFIER_KEY`: a distinct configured verification-service public key, outside buyer/reviewer/worker keys.
- Private `aci-verifier-secret.json` containing the verifier's existing signing identity. Never generate a new operator identity and call it independent.
- Optional trusted `FLASHFIRM_ACI_AUDITOR_URL` and token for a real auditor. It receives public attestation/session metadata only, never task plaintext.
- An approved `aci-spend-policy.json` with `{enabled,capFen:2000,origin,reservationFen}` based on actual bounded pricing, using the original `provider-budget.json` and its shared lock. A missing/corrupt ledger fails closed. The current 10/12 calls and ¥15.91/20 reservations remain unchanged.
- A task/worker-bound `flashfirm-aci-release/1` approval containing reviewed compose hashes, session IDs, byte/token/reservation limits and expiry.
- A fresh `flashfirm-aci-runtime-audit/1` signed by the pinned audit authority: matching gateway evidence/keyset, session evidence, OS/KMS/debug policy, measured model/runtime and validity interval.

Do not copy compose hashes from an endpoint and treat them as independently reviewed. A snapshot audit must match the current fresh report; use the real auditor callback when quote evidence changes.

```sh
npm run inference:private -- /private/input.json /private/shared-runtime /private/new-output
```

The input has `{taskRoot,task,workerId,model,approval,runtimeAudit}`. The service never logs task text, API keys or model output. New output directory and cumulative reservation fence retries. Keep the output private.

For an existing post-delivery evaluation plan, `privacyMode: "CONFIDENTIAL_INFERENCE"` and `privateTaskDigest` require certificates for **every** worker artifact. Submit `{proofs:[{certificate,approval}]}` to `flow/inference`. The API accepts only configured verifier signatures tied to exact task/input/artifact commitments, and revalidates release approvals when locking the manifest. Ordinary commercial public-model evaluation refuses confidential mode. Certificate verification is free; it never calls a model.

### Still required for a real confidential task

The real auditor, reviewed production release/OS/KMS/model measurements, ACI credentials and fresh paid inference receipts are not configured or obtained by the offline tests. A complete multi-agent re-evaluation also does not fit the remaining original two-call allowance. No private live success is claimed. External operators, approved spend and wallet confirmations remain necessary for real execution.

## Reproduce validation

```sh
npm test
npm run test:task-settlement
npm run test:sandbox
npm --prefix cloudflare run check
npm run build:pages
```

The unit tests include real official-SDK Ed25519 receipt/body/session verification, negative release/audit cases, shared-budget exhaustion, replay fences, exact native recipients, forged callbacks, changed bytecode and payment path isolation. Hardware connections in unit tests are synthetic fixtures and are clearly labeled.

# Verification APIs and external deployment

These APIs record evidence. They do not send money, release secrets, run an enclave, or certify a reviewer's independence. All workspace endpoints require an owner-scoped bearer token. The production backend is not yet deployed.

## Operator configuration

Set `FLASHFIRM_INTEGRATION_CONFIG` to an absolute path to a private operator-controlled JSON file and restart the backend. The file must not be writable by group/others. In Docker, mount it read-only and pass the environment variable explicitly. Do not commit RPC credentials or copy this file into Pages. With no file, destination routes and TEE verification are disabled.

```json
{
  "routes": [{
    "id": "dedicated-receipt",
    "rpcUrl": "https://your-trusted-rpc.example",
    "chainId": "0x1",
    "token": "<lowercase ERC-20 contract address>",
    "recipient": "<dedicated lowercase recipient address>",
    "minimumAmount": "<positive integer in token base units>"
  }]
}
```

This is a configuration template, not a supported payment route or authorization to transfer. Choose the actual chain, asset and dedicated destination before enabling it. Routes are loaded once; HTTP input cannot select an RPC URL, amount or recipient. RPC methods are restricted to chain ID, receipt and block reads. No broadcast method is available.

## Destination observation and replay prevention

```js
const readiness = await client.integrationStatus();
const request = await client.createDelivery(firm.id, 'dedicated-receipt');
// Only after a separately authorized, externally performed transfer:
const observed = await client.verifyDelivery(firm.id, request.id, transactionHash);
const history = await client.deliveries(firm.id);
```

The expectation is immutable and survives process restarts. A chain/token/recipient tuple can belong to only one request across all owners, so shared collection addresses are intentionally unsupported. Finalized matching ERC-20 logs must meet the minimum amount, and their block time must be at or after request creation. A chain/transaction pair can be consumed only once, including concurrent requests and multiple matching logs. An RPC timeout or invalid observation leaves the request pending; it never initiates or repeats a transfer.

`paymentVerified` describes the destination ERC-20 observation only. `crossChainOriginVerified:false` and `settlementExecuted:false` remain explicit. A destination transfer alone does not prove an Intents origin deposit, bridge identity, task delivery or refund. No funds have been sent through this integration. After restoring an old backup, pending requests require reconciliation; do not treat the snapshot as a complete transaction-consumption history.

## TEE challenge lifecycle

To enable the experimental verifier, operator configuration additionally needs `tee.rootPem` (the independently obtained pinned AWS Nitro G1 root) and `tee.pcrs` containing nonzero 96-character lowercase hexadecimal values for PCR 0, 1 and 2. Obtain those values from the reviewed enclave build, not a prover's submission. Invalid root fingerprints and zero/missing measurements are rejected at startup.

```js
const challenge = await client.attestationChallenge(firm.id, taskDigestHex, enclavePublicKeyHex);
// The actual enclave must obtain an NSM attestation bound to this nonce/task/key.
const evidence = await client.verifyAttestation(firm.id, challenge.nonce, attestationCborBase64);
```

Challenges persist in SQLite, expire after two minutes and are consumed atomically after successful cryptographic verification. At most ten unconsumed challenges are allowed per workspace. Cross-owner access, replay, concurrent double acceptance, closed workspaces and expiry during verification are rejected. Backup restoration invalidates outstanding challenges. Verified events stay in workspace history; no secret is released and no workload execution is inferred. Lifecycle tests use an explicitly injected mock verifier; they are not positive Nitro hardware evidence.

Still required: a real enclave/provider, reproducible worker image, reviewed measurements, hardware attestation success test, private ingress and secret-release design. An external model API still sees plaintext prompts.

## Reviewer lifecycle

Follow [reviewer onboarding](REVIEWER-ONBOARDING.md). `client.recheckReviewer(accountId, policyHash)` checks that the originally bound NEAR public key is still present at a fresh finalized block. It does not ask the reviewer to sign or prove present liveness. `client.revokeReviewer(accountId, policyHash, reason)` permanently marks the local binding revoked without removing any on-chain key. Revocation wins over an in-flight recheck. Reasons must not contain confidential material. A revoked binding is not replaced in place; use a newly reviewed policy for a new enrollment.

Actual independent operators and conflict-of-interest review are still required. Development keys controlled by one operator do not meet that condition.

## Public backend launch

Provision a persistent host and a DNS hostname. Use `deploy/compose.yaml`; keep port 43180 bound to host loopback. The host Caddy configuration in `deploy/Caddyfile` proxies that port while preserving Host. Set `FLASHFIRM_DOMAIN` to the hostname and `FLASHFIRM_PUBLIC_ORIGIN` to its exact HTTPS origin. Validate the Caddy configuration before starting it; DNS and inbound TLS ports must be configured. The template has not been tested on a public host.

After deployment, run the unauthenticated read-only check:

```sh
node scripts/check-public-backend.mjs https://your-backend.example
```

It checks TLS/health, denied anonymous workspace access, disabled mutable fixtures, and rejected foreign Origin. It uses no bearer token and causes no model calls. It does not establish SSO, monitoring, backup retention or sustained uptime. GitHub Pages cannot host this persistent Node/SQLite backend.

## Testnet failed-transfer recovery

`node scripts/recovery-preflight.mjs` reads only the developer testnet account. It loads no private key and sends no transaction. The isolated scenario requires a new treasury and a never-created named recipient. After quorum and the appeal window, the first claim must return false, clear pending credit and restore the exact unpaid amount; only then create the recipient and retry. No account deletion is needed. The sandbox runner now uses this same missing-recipient sequence.

The planning reserve is 3 testnet NEAR, not an estimated fee: most funds are retained in test accounts for contract storage and gas reserves. After the user funded the development account, `scripts/testnet-recovery.mjs` completed the isolated scenario on November 3, 2026 (Asia/Shanghai). The failed transfer returned false with exactly one AccountDoesNotExist receipt, the callback restored all 0.001 NEAR credit, the recipient was created, and retry returned true. The final treasury is Closed with zero credits and pending balances. See `evidence/testnet-recovery.json` for transaction hashes and finalized block heights. The runner fences each broadcast with an exclusive intent journal and refuses automatic replay after an ambiguous result. All reviewers are same-operator development identities. Existing completed treasuries and earlier ambiguous deployment journals remain untouched; no account was deleted.

# Integration upgrade — 2026-11-02

**2026-11-03 follow-up:** [Task settlement](TASK-SETTLEMENT.md) and
[operations/recovery](OPERATIONS-UPGRADE.md) supersede the earlier implementation
status below. A verified-identity organization adapter, opt-in encrypted email
outbox, scheduled external health checks, encrypted offsite backups and an actual
isolated D1 restore have been added. Access/email providers still need setup;
background push and trusted model inference remain unimplemented. The private
quotation client now verifies hardware/platform/release approval before
encryption, but no real private-material trial has been completed.

The subsequent [task dossier upgrade](TASK-DOSSIERS.md) adds a shared report,
review and inbox workflow to Node and Workers. It deliberately keeps settlement,
independent identity and confidential-inference gates false. The Phala public
quotation task succeeded later; its stopped instance and disk are retained at
the user's request.

## Deployment preparation

The Dockerfile and `deploy/compose.yaml` package a single-host service with a persistent volume, a non-root process, a read-only root filesystem, health checks and graceful worker draining. Public mode requires an exact HTTPS origin and persistent runtime path; it rejects mismatched Host/Origin and unauthenticated workspace requests. Mutable fixture endpoints are disabled in public mode. A TLS reverse proxy must preserve the original Host and expose only the intended domain. Do not expose port 43180 directly.

GitHub Pages remains a static evidence site. A separate Workers + D1 + Workflows variant is now [publicly deployed on Workers Free](CLOUDFLARE-FREE.md), with real receipt verification, durable writes, encrypted notes and access-control checks. Its paid AI runner is disabled and it does not port all Node integration modules. Although Docker is unavailable locally, GitHub Actions successfully built the Node container and verified startup, health and denied unauthenticated/wrong-Host requests at commit `329ec46` (run `41463440742`, job `125338033260`). That full container is not publicly deployed. Current bearer tokens are owner-scoped, expiring and revocable, but organization login/SSO, self-service provisioning, notification delivery and external uptime monitoring remain unfinished.

Example deployment after provisioning a suitable host:

```sh
export FLASHFIRM_PUBLIC_ORIGIN=https://your-chosen-domain.example
docker compose -f deploy/compose.yaml up --build -d
docker compose -f deploy/compose.yaml exec backend node scripts/operator-token.mjs
```

The token is written privately inside `/data`; never copy it to Pages or logs. A reverse proxy and its TLS configuration must be ready before publishing DNS. Provision model configuration only after restoring the existing cumulative budget ledger; never start a fresh ledger to bypass a spending cap.

## Backup and recovery

`src/backup.mjs` uses SQLite's consistent snapshot and AES-256-GCM encryption under a separate 32-byte offline backup key. The archive includes the database and its vault key, not wallet keys or provider credentials. Keep the backup key outside the host and outside the backup archive. `scripts/backup.mjs` accepts its file path through `FLASHFIRM_BACKUP_KEY_FILE`.

Restore only into a new directory. Integrity is checked, sessions are revoked, and queued/running work is failed closed so historical paid calls cannot replay. Restore tests recover encrypted notes and reject wrong keys/overwrites. Current provider policy and cumulative spend must be reconciled separately. Scheduling and off-host storage are not configured yet.

## Independent reviewers

`src/reviewer-binding.mjs` validates two Ed25519 signatures over the same domain-separated challenge: one by the report reviewer and one by a full-access public key currently registered on the pinned NEAR testnet account. It verifies the account's key list at one fresh final block. No access key is added, exported or requested by this protocol.

The authenticated `POST /api/workspaces/reviewer-challenge` endpoint pins the account, reviewer key and policy hash and issues a random 32-byte nonce with a five-minute lifetime and server-selected HTTPS audience. The reviewer adds their NEAR public key and signs the canonical payload with both keys on their own machine. Submit the envelope to `POST /api/workspaces/reviewer-bindings`; successful verification consumes the nonce atomically and persists the binding under the authenticated owner. Duplicate concurrent acceptance, cross-owner access and expired challenges are rejected. `GET` on the same route lists only that owner's bindings. These records prove account/key control; the roster still needs real identity/conflict-of-interest checks. No one has been onboarded as an independent operator yet. Never send private keys to FlashFirm.

## TEE

Experimental Nitro attestation verification is implemented in `src/nitro-attestation.mjs`: bounded CBOR/COSE decoding, ES384 signature, OpenSSL certificate path validation against the documented AWS Nitro root fingerprint, freshness, nonce, task digest, enclave public key and nonzero PCR 0/1/2 allowlist. The trusted PCR values must come from a reviewed reproducible enclave image, not from the submitted evidence. Never copy the prover's PCRs into the allowlist to make verification pass.

Use `scripts/verify-attestation.mjs` for standalone Nitro verification or the authenticated workspace attestation API for persistent, two-minute, single-use challenges. Nonces are atomically consumed, invalidated on restore, and bound to owner/workspace/task/key and operator-configured measurements. Parser rejection, claim-binding and mocked lifecycle tests have run for that implementation; no positive Nitro hardware evidence is claimed. The separate [Phala TDX worker](PHALA-TEE.md) completed a real public quotation task with official API hardware verification, measured Compose checks and encrypted signed results; its test instance is stopped. Nitro NSM execution, private-data ingress, secret provisioning, independently reviewed OS/KMS/governance and confidential production workloads remain missing. There is no TEE secret-release endpoint. An external model API would still receive plaintext prompts even if its caller ran in an enclave; do not describe such calls as confidential inference.

Specification: AWS Nitro Enclaves documentation, `verify-root` and AWS Nitro root G1. The root certificate must be obtained independently and its built-in SHA-256 fingerprint must match; submitted certificate roots are never trusted.

## Cross-chain collection

`src/intents.mjs` implements the official 1Click `/v0/tokens`, dry `/v0/quote` and read-only `/v0/status` shape. Preview requests are always `dry: true`, use pinned route/recipient/refund addresses and integer limits, and cannot generate a funding instruction. Only a locally saved executable quote can be used for status recovery. SUCCESS/REFUNDED labels alone never establish delivery; no automatic redeposit is allowed.

An ERC-20 destination verifier checks pinned chain ID, finality, successful receipt, token, recipient and minimum Transfer amount. The authenticated delivery API persists immutable requests, requires a dedicated destination, rejects pre-request transfers, and consumes each chain/transaction pair at most once across owners. These are destination observations, not bridge-origin proof or credits; the API is not integrated with the NEAR treasury. RPC and route configuration are operator-only. Native-coin destinations and non-EVM finality verifiers are not implemented. See [integration guide](EXTERNAL-INTEGRATIONS.md) for API schemas, restore reconciliation and deployment checks.

Official SDK source inspected: `defuse-protocol/one-click-sdk-typescript`, `QuoteRequest`, `QuoteResponse`, `GetExecutionStatusResponse`, `SwapDetails`, `OneClickService`. Earlier service access returned HTTP 521; that historical blocker was superseded by signed live quotes. The original FunctionCall wallet response failed exact-action validation and remains locked with its order retained. A separate native Transfer completed the authorized 0.5 NEAR → 1.861840 USDC Arbitrum demonstration, with final source and finalized destination evidence. [Native payment verification](NATIVE-NEAR-PAYMENT.md) does not complete automatic task settlement or independent refund verification. Never replay either order.

# Integration upgrade — 2026-11-02

## Deployment preparation

The Dockerfile and `deploy/compose.yaml` package a single-host service with a persistent volume, a non-root process, a read-only root filesystem, health checks and graceful worker draining. Public mode requires an exact HTTPS origin and persistent runtime path; it rejects mismatched Host/Origin and unauthenticated workspace requests. Mutable fixture endpoints are disabled in public mode. A TLS reverse proxy must preserve the original Host and expose only the intended domain. Do not expose port 43180 directly.

GitHub Pages remains a static evidence site. No cloud account is currently available. Although Docker is unavailable locally, GitHub Actions successfully built the container and verified startup, health and denied unauthenticated/wrong-Host requests at commit `329ec46` (run `41463440742`, job `125338033260`). It is not deployed to a public backend. Current bearer tokens are owner-scoped, expiring and revocable, but organization login/SSO, operator provisioning, notification delivery and external uptime monitoring still require deployment decisions.

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

Use `scripts/verify-attestation.mjs` for an actual attestation document and requester-owned challenge. Only parser rejection and claim-binding tests have run; no successful real hardware attestation has been verified. Enclave image, NSM worker, private-data ingress, one-time nonce persistence, secret provisioning and workload execution remain missing. There is no TEE secret-release endpoint. An external model API would still receive plaintext prompts even if its caller ran in an enclave; do not describe such calls as confidential inference.

Specification: AWS Nitro Enclaves documentation, `verify-root` and AWS Nitro root G1. The root certificate must be obtained independently and its built-in SHA-256 fingerprint must match; submitted certificate roots are never trusted.

## Cross-chain collection

`src/intents.mjs` implements the official 1Click `/v0/tokens`, dry `/v0/quote` and read-only `/v0/status` shape. Preview requests are always `dry: true`, use pinned route/recipient/refund addresses and integer limits, and cannot generate a funding instruction. Only a locally saved executable quote can be used for status recovery. SUCCESS/REFUNDED labels alone never establish delivery; no automatic redeposit is allowed.

An ERC-20 destination verifier checks pinned chain ID, finality, successful receipt, token, recipient and minimum Transfer amount. It requires a trusted RPC and a unique saved task/transaction binding before crediting any task; it is not integrated with the NEAR treasury. Native-coin destinations and non-EVM finality verifiers are not implemented.

Official SDK source inspected: `defuse-protocol/one-click-sdk-typescript`, `QuoteRequest`, `QuoteResponse`, `GetExecutionStatusResponse`, `SwapDetails`, `OneClickService`. Actual service access returned HTTP 521 in this environment. No live quote, cross-chain payment or refund is claimed. Mainnet route and funds are not authorized; a new explicit transfer approval would be required after choosing a supported route.

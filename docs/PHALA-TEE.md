# Phala TDX quotation worker

## Status

The standalone worker, encrypted client and evidence verifier are implemented.
Local cryptographic/policy tests pass. A real Phala deployment was attempted on
2026-11-03; the provider rejected it with:

> You are not allowed to deploy the target applications since it violates our terms of use.

Request ID: `97d611347f271bb2674907bca3275445`.

The provider did not give a more specific reason. Its resource list subsequently
showed “Nothing deployed yet”; billing still showed $5 and auto-topup disabled.
No CVM or positive hardware evidence was obtained. Do not call this a live TEE,
retry through an alternate entry point to bypass the refusal, or infer an
account, geographic or application-specific cause without provider clarification.

The official [troubleshooting guide](https://docs.phala.com/phala-cloud/troubleshooting/troubleshooting.md)
describes this message as a possible Docker-image anti-spam flag, including false
positives, and recommends official base images or support review. It does not
establish which rule triggered this deployment.

One controlled diagnostic retry used the fully qualified official image
reference `docker.io/library/node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284`.
The immutable image digest and application source were unchanged. It was also
rejected, with request ID `915583642a9c3f2d9f5fda9461e52af7`.
Thus image-reference normalization did not resolve the restriction. The resource
list remained empty and the refreshed balance remained $5. No further deployment
retry of that inline-source configuration is planned.

The expanded support message is retained locally in ignored
`.runtime/phala/support-review.txt`, including both request IDs, readable public
source, image/Compose hashes, configuration and the limited workload scope.
After explicit user authorization, it was submitted through the workspace's
official support page. Ticket **#1342** is **Open**; the console shows creation
time `2026-11-03 14:43` (as displayed by the console). No provider response or
resolution has yet been observed. No secrets or wallet data were included.

Short support message:

> My workspace is 0xcaptain888s-projects. A deployment named
> flashfirm-quotation-proof failed with a terms-of-use rejection,
> request 97d611347f271bb2674907bca3275445. It is a dependency-free Node service
> on an official digest-pinned Node image. It checks exact quotations against
> public documents, obtains a dstack hardware quote, and signs its result.
> There is no mining, proxy service, wallet signing, private customer data or
> external paid model call. Public logs and public system information were
> disabled. Could you explain the restriction and the compliant deployment
> requirements? Please do not enable automatic billing or change my plan.

## Build and verify

```sh
npm run tee:build
node --test test/phala.test.mjs
# After the provider resolves the deployment restriction:
# deploy the exact .runtime/phala/docker-compose.json through the Phala console
FLASHFIRM_USE_SYSTEM_PROXY=1 npm run tee:check -- https://YOUR-ENDPOINT.phala.network/
```

The proxy option requires the separately installed Cloudflare development
dependencies and uses the workstation's existing localhost proxy. It makes no
system proxy changes. The build embeds the complete reviewed worker module into
Compose, pins the official Node linux/amd64 image by digest, and writes a source
and Compose hash manifest into ignored `.runtime/phala/`. No runtime source
download, package install, provider key or wallet secret is involved.

The check command creates a unique evidence directory before contacting the
CVM. It uses public repository documentation, with one exact quotation and one
invented quotation that must yield `CHALLENGED`. It does not call an AI model.
The command never publishes private runtime files to GitHub automatically.

## What is checked

1. The caller creates a fresh 32-byte nonce, task digest and five-minute expiry.
2. Inside the instance, the worker generates ephemeral Ed25519 signing and
   X25519 encryption keys. A SHA-256 domain-separated context hash binds both
   public keys and the caller's challenge into the 64-byte TDX report data.
3. Before sending the task, the caller obtains hardware verification directly
   from the official Phala verification API. The raw quote checksum, TDX v4
   framing, debug flag, report data and parsed measurement fields must agree.
4. The verifier hashes each RTMR3 event's type/name/payload, compares its digest,
   and replays the register. It checks that the measured app-compose hash
   commits to the exact locally built Docker Compose file. A prover's own
   `verified:true` field or self-consistent replacement Compose is insufficient.
5. The task uses X25519, HKDF-SHA256 and AES-256-GCM with direction-separated
   authenticated context. Each challenge can execute once; failure consumes
   that session. The result is signed and encrypted, checked against the
   attested key and reproduced locally.

The official quote API permanently exposes submitted quotes by checksum. The
initial test sends only a public-task digest, random nonce and ephemeral public
keys. Do not embed private report contents or customer identifiers in a quote.

## Explicit trust boundaries

The hardware signature check trusts the official Phala API over TLS. It is
**not** a locally executed Intel DCAP verifier. MRTD and RTMR0–2 have not been
independently reproduced against an approved OS image. KMS attestation, platform
governance and production network attestation have not been reviewed.
Consequently the verifier always returns `secretReleaseAllowed:false` and
`platformMeasurementsIndependentlyVerified:false`, even for a valid public-task
hardware/application check.

The worker checks exact strings against caller-pinned source bytes. It does not
certify semantic entailment, source authority, an independent human reviewer or
DeepSeek inference inside a TEE. External model APIs see their own prompts.
The existing AWS Nitro verifier and its workspace challenge API remain a
separate implementation; a TDX quote must never be passed off as Nitro evidence.

Before confidential production use, run a pinned dstack-verifier outside the
CVM; verify approved OS measurements, TCB/advisory policy, KMS and network
bindings, plus reviewed application governance. Do not learn the measurement
allowlist from the prover. Pin worker/container changes before a new challenge.

## Resource and cost lifecycle

The approved first-run cap is $5. The selected console configuration estimated
$0.06074/hour, including 20 GB storage, before the failed deployment.
This is an observed estimate, not a guaranteed future price.

After an eventual successful short test, stop the CVM immediately and check
whether retained disks still incur charges. An application process timeout
does not stop VM billing. This worker limits itself to 32 attestation attempts,
eight executions and one hour of task acceptance; those limits do not replace
provider resource shutdown. Do not add a card, enable auto-topup, increase the
plan or erase cloud data without the appropriate authorization.

## Standard dedicated-container alternative

At the user's request, a second packaging method is prepared:

- `tee/phala.Dockerfile` copies the readable module into `/app/phala-worker.mjs`
  on the same digest-pinned official Node base.
- `tee/.dockerignore` limits the build context to this worker and Dockerfile.
  Repository runtime files, wallet material and provider credentials cannot enter
  this build context.
- `.github/workflows/phala-container.yml` builds a `linux/amd64` image, tests the
  actual container, then publishes it to GHCR using the short-lived workflow
  token. It runs only on explicit workflow dispatch.
- `scripts/check-phala-container.mjs` mounts a **fake** dstack Unix socket and
  tests encrypted delivery, result signatures, unsupported quotations, replay
  rejection, and exact source bytes inside the image. Passing this integration
  check proves container behavior, **not** a hardware attestation.

After reviewing the successful workflow and anonymously accessible registry
digest, build the deployment file with:

```sh
npm run tee:build -- --container-image ghcr.io/0xcaptain888/flashfirm-phala-quotation@sha256:THE_VERIFIED_IMAGE_DIGEST
```

The resulting Compose uses the dedicated immutable image and a plain
`node /app/phala-worker.mjs` command. It contains no inline Base64 code, `node -e`,
source download or package installation. Existing hardware/application evidence
checks and the $5 first-run limit remain unchanged.

This is transparent standard application packaging, not evidence of a policy
clearance. A successful image build does not establish why the earlier request
was rejected, nor guarantee Phala will accept this deployment. Keep support
ticket #1342 and the original failure history; if this distinct packaging is
also rejected, request provider review instead of changing identities, IP
addresses, or concealing application behavior.

Official technical references:

- `https://docs.phala.com/phala-cloud/attestation/verify-your-application.md`
- `https://docs.phala.com/phala-cloud/attestation/verify-the-platform.md`
- `https://docs.phala.com/phala-cloud/phala-cloud-api/attestations.md`
- `https://github.com/Dstack-TEE/dstack/tree/next/dstack/verifier`
- `https://github.com/Dstack-TEE/dstack/blob/next/sdk/js/src/client-v0.ts`
- `https://docs.phala.com/phala-cloud/cvm/create-with-docker-compose.md`
- `https://docs.phala.com/phala-cloud/troubleshooting/troubleshooting.md`

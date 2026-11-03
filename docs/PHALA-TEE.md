# Phala TDX quotation worker

## Status

**A real TDX public quotation task passed on 2026-11-03 at 07:13:07 UTC.**
A dedicated immutable GHCR container was accepted by Phala. The check verified
the hardware signature through the official API, exact nonce/task/public-key
binding, the measured Docker Compose file, RTMR3 event replay and a signed,
encrypted result. The valid quotation was recognized; an invented quotation
yielded `CHALLENGED`.

The instance was then shut down; the console showed **CVM is powered off** and
a remaining balance of **$4.99**. Its 20 GB disk is retained and still billed.
No auto-topup or payment card was enabled. This is a completed historical
public-task check, not an always-on endpoint or confidential production service.

- Public evidence: [`../evidence/phala-public-task.json`](../evidence/phala-public-task.json)
- Repository-pinned policy and lifecycle: [`../evidence/phala-readiness.json`](../evidence/phala-readiness.json)
- Container: `ghcr.io/0xcaptain888/flashfirm-phala-quotation@sha256:a152f2f1f4fdfbce2a96255982537d4a9571256311382e7dfec6be4a462338b7`
- Container source revision: `c32562eacfb76ffa7b9332064b0de34354ef7b7a`
- Measured app-compose SHA-256: `9c5ac0e34d578d78a689b38cf8584a82cb891ae461f75027641edb69831c13d8`
- Official verification report ID: `9f4b214fbbfa715f17d7cf7f06bf552f31e84148659e75bb3a05b795f8081fd0`
- Raw quote SHA-256: `e06ade534cc5dc2b9622609a12b10f7dd6809cea0c30be50a3ac7afee4d86061`

## Earlier deployment refusals

The original inline-source deployment on 2026-11-03 was rejected with:

> You are not allowed to deploy the target applications since it violates our terms of use.

Request ID: `97d611347f271bb2674907bca3275445`.

The provider did not give a more specific reason. Its resource list subsequently
showed “Nothing deployed yet”; billing still showed $5 and auto-topup disabled.
At that stage no CVM or positive hardware evidence was obtained. Do not
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
time `2026-11-03 14:43` (as displayed by the console), assigned to Leechael.
No substantive provider explanation was observed before the dedicated-container
deployment succeeded. Its success does not establish the earlier scanner's
exact trigger. No secrets or wallet data were included.
A follow-up reporting the successful container, public proof identifiers and API
format observations was submitted to the same ticket; the console showed
`2026-11-03 15:21`. It requests clarification only, with no resource or billing
changes.

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
npm run tee:build -- --container-image ghcr.io/0xcaptain888/flashfirm-phala-quotation@sha256:a152f2f1f4fdfbce2a96255982537d4a9571256311382e7dfec6be4a462338b7
node --test test/phala.test.mjs
# Historical public evidence; offline replay explicitly uses a recorded API verdict:
npm run tee:verify-public
# Independently ask the official API to reverify the historical quote:
npm run tee:verify-public -- --online
# For a new authorized short test, deploy the exact generated Compose:
# clear the console's optional prelaunch-script.sh; leave it empty.
# Keep Public Logs and Public System Info OFF; use no secrets/SSH keys.
FLASHFIRM_USE_SYSTEM_PROXY=1 npm run tee:check -- https://YOUR-ENDPOINT.phala.network/
```

The proxy option requires the separately installed Cloudflare development
dependencies and uses the workstation's existing localhost proxy. It makes no
system proxy changes. The recommended build uses the dedicated linux/amd64
container and writes a source and Compose hash manifest into ignored
`.runtime/phala/`. Calling `tee:build` without `--container-image` instead emits
the older embedded-source form; that is not the successful deployment method.
No runtime source download, package install, provider key or wallet secret is
involved in the successful configuration.

The check command creates a unique evidence directory before contacting the
CVM. It uses public repository documentation, with one exact quotation and one
invented quotation that must yield `CHALLENGED`. It does not call an AI model.
The command never publishes private runtime files to GitHub automatically.
`scripts/export-phala-proof.mjs` separately exports only a successful test whose
sole source exactly matches public `docs/MAINNET-PAYMENT.md`. It whitelists proof
fields and checks them before publication.

## Real-service compatibility checks

The actual v0.5.12 service exposed three details absent from the synthetic fixture:

- The quote retained 70 zero-filled buffer bytes beyond its declared signature
  length. The parser accepts at most 256 trailing zero bytes, rejects truncation
  and any nonzero tail, and hashes/submits the entire original buffer.
- The official API's report identifier labelled `checksum` differed from
  SHA-256 of the raw bytes in this observation. Instead of dropping byte
  binding, the live checker downloads `/attestations/raw/{id}` from the official
  API and requires an exact byte-for-byte match. The report ID and actual raw
  SHA-256 are recorded separately.
- Runtime event `digest` fields were empty, including events with empty payloads.
  Every digest is independently computed using dstack's v1 rule, then the whole
  RTMR3 is replayed and matched to the signed quote. A supplied nonempty digest
  must also match. Event tampering is rejected in either representation.

Phala initially added an optional prelaunch script. It was removed through the
console and the instance restarted before the successful challenge. The verifier
still rejects any nonempty prelaunch script; no script allowlist was learned from
the prover. Regression tests cover the compatibility cases and their invalid
counterparts.

The offline public-proof command checks the repository-pinned container/source/
Compose policy, recorded challenge time, event replay, task/result binding and
attested-key signature. Its recorded API verdict is not a new hardware check.
`--online` fetches a new official verdict and exact original bytes independently;
it rechecks historical evidence and does not create a new task or fresh nonce.

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

The successful short test was followed by shutdown. The official billing page
states that CPU storage is charged while running **and stopped**; deleting the
machine is required to end all charges. The user explicitly chose to retain the
stopped instance and its 20 GB disk. Official storage pricing checked through
the console's pricing page was $0.000139/GB/hour: $0.00278/hour, $0.06672/day or
$2.0016 per 30 days for 20 GB, billed by the minute against allocated capacity.
This is ongoing storage usage, not a new resource deployment. An application process timeout
does not stop VM billing. This worker limits itself to 32 attestation attempts,
eight executions and one hour of task acceptance; those limits do not replace
provider resource shutdown. Do not add a card, enable auto-topup, increase the
plan or erase cloud data without the appropriate authorization.

## Standard dedicated-container alternative

At the user's request, a second packaging method was implemented and deployed:

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

The workflow at revision `c32562eacfb76ffa7b9332064b0de34354ef7b7a`
successfully built, container-tested and published the image. Anonymous registry
verification checked the manifest/config/layer hashes, linux/amd64 architecture,
source revision, startup command and exact worker source before deployment.

Phala accepted this packaging in the same account/workspace. The original
failure history and support ticket #1342 are retained. This successful deployment
does not establish the scanner's exact earlier trigger.

Official technical references:

- `https://docs.phala.com/phala-cloud/attestation/verify-your-application.md`
- `https://docs.phala.com/phala-cloud/attestation/verify-the-platform.md`
- `https://docs.phala.com/phala-cloud/phala-cloud-api/attestations.md`
- `https://github.com/Dstack-TEE/dstack/tree/next/dstack/verifier`
- `https://github.com/Dstack-TEE/dstack/blob/next/sdk/js/src/client-v0.ts`
- `https://docs.phala.com/phala-cloud/cvm/create-with-docker-compose.md`
- `https://docs.phala.com/phala-cloud/troubleshooting/troubleshooting.md`
- `https://github.com/Dstack-TEE/dstack/blob/d7e15dc9020101bb37d93ea9eec5f1f4fefe93e7/dstack/cc-eventlog/src/runtime_events.rs`
- `https://cloud.phala.com/about/billing`

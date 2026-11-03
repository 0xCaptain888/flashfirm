# Organization access, notifications and recovery

## Organization sign-in

The free public backend now supports cryptographically verified Cloudflare
Access JWTs. Configure `ACCESS_ISSUER` as your team's HTTPS
`*.cloudflareaccess.com` origin and `ACCESS_AUDIENCE` as the exact application
AUD. An Access application must protect the service and supply the assertion.
Keep the organization sign-in route protected. If the application protects the
entire host, health checks and backup downloads additionally need an appropriate
service-identity policy; the current monitor authenticates backups with the
separate application bearer token, not an Access service token. Test those routes
after changing the identity policy rather than silently blocking scheduled jobs.
The current Wrangler authorization does **not** include Access administration;
the identity application has not been created or enabled automatically.

The verifier fixes issuer/JWKS URL and RS256, verifies signature, audience,
expiry/not-before and identity claims, and ignores caller-supplied signing-key
URLs. An authenticated person can create one personal organization or join an
invitation bound to the exact verified email. Public requests cannot mint an
arbitrary owner's token.

Organization sessions expire within one hour. Membership and role are read on
every request, so removal takes effect immediately. Admins invite Editors or
Viewers; Viewers cannot mutate task data. Owner organization IDs are derived from
the identity provider's issuer and subject. Existing private operator tokens
continue to work. POST `/api/workspaces/logout` revokes the current token.

`/api/workspaces/organization/members` (GET), `/invite` and `/revoke` (POST)
provide administration. An invitation response is private; it is not emailed
without a configured sender and a separate communication instruction.

## Notifications

- In-app inbox and acknowledgements persist.
- Optional browser Notifications show new inbox items while the page is open.
  This is explicitly **foreground notification**, not a background push service.
- Verified organization users can opt in/out through
  `/api/workspaces/email-subscription` with `{enabled:true|false}`.
- The encrypted outbox deduplicates each recipient/event, rechecks membership
  and subscription before sending, leases dispatch, uses a stable provider
  idempotency key, retries transient failures and stops after five attempts or
  one hour. An expired or failed notification remains inspectable in D1.
- Each scheduled tick rotates through one subscription/workspace pair per
  channel, with a durable cursor, up to three unread events and at most two
  dispatches per channel. Previously queued unread events retain their retry
  state without blocking later alerts. This is a bounded free-tier preview, not an immediate
  or unbounded bulk-notification service.

Email requires `RESEND_API_KEY`, an approved `MAIL_FROM` sender and
`MAIL_SEND_ENABLED=yes`. No sender has been configured; no email has been sent.
Background Web Push is implemented separately from foreground alerts:

- `/api/workspaces/push-config` reports availability; `/push-subscription` accepts
  an explicit organization member opt-in or opt-out. At most three enabled
  devices are permitted, including database enforcement for concurrent requests.
- Subscriptions and queued metadata are encrypted before D1 storage. Only fixed
  browser-vendor push hosts are accepted, never arbitrary HTTP destinations.
- `web-push` generates standards-based AES128GCM payloads and VAPID signatures.
  Fetch redirects are forbidden. Notifications contain only a generic task-update
  message and workspace ID; reports, addresses and payment details are excluded.
- A service worker displays alerts while the page is closed and opens only a
  same-origin workspace link. The user must authenticate to read the task.
- Dispatch rechecks subscription and active organization membership, uses bounded
  leases/retries, coalescing topics/tags, and disables endpoints returning 404/410.
  Network ambiguity can cause duplicate delivery; topics/tags reduce duplication.
- The `ACCEPTED` state means the push service accepted the request. It does not
  establish that the user's device displayed or read the notification.

```sh
node scripts/configure-web-push.mjs --apply
```

This stores private VAPID material only in the ignored local runtime and Workers
Secrets. It enables the channel for verified organization users who subsequently
opt in. VAPID is configured in the current deployment; no real push has been
sent. Organization identity is still unconfigured, so legacy operator tokens
cannot subscribe. [Public readback](../evidence/public-operations-upgrade.json)
checks those separate states. Local standards-encryption tests and a real local Workers-runtime crypto
compatibility check passed. Actual subscribed-device acceptance/display remains
an external validation step, following organization identity setup.

## Encrypted offsite backups

`scripts/configure-offsite-backup.mjs --apply` creates a separate random
backup-download token and a 3072-bit RSA restore key. Only the public key and
token hash go to Cloudflare; the backup token goes to GitHub Actions Secrets.
The private restore key remains at:

```
.runtime/offsite-backup/restore-private.pem
```

**Copy this private key to your own offline storage.** The server and GitHub
cannot restore a backup without it. Never commit the private key or setup file.

The authenticated `/api/operations/backup` endpoint takes one D1 batch snapshot,
including the vault encryption key, and encrypts it with a fresh AES-256-GCM key
wrapped by RSA-OAEP-SHA256. Wallet/model/provider credentials are excluded.
Snapshot size is limited to 8 MB; exceeding this fails rather than exporting a
partial backup.

The GitHub `operations.yml` workflow checks the public backend and Pages evidence
every six hours and uploads the encrypted snapshot as an artifact retained for
30 days. This separates the backup provider from Cloudflare; no geographic
residency or cross-region SLA is claimed. CI failures appear through GitHub's
normal workflow notifications. This is scheduled monitoring, not continuous
uptime coverage.

Run `41617701302` passed both health checks and uploaded a real encrypted artifact.
It was downloaded from GitHub, decrypted and restored into a fresh local database;
integrity and revoked-session checks passed. See
`evidence/offsite-backup-upgrade.json`. No private key or plaintext backup was
uploaded to GitHub. The added push migration preserves older snapshot support.

## Recovery drill

```sh
FLASHFIRM_USE_SYSTEM_PROXY=1 node scripts/cloud-restore-drill.mjs --remote
```

The drill decrypts a real live snapshot locally, checks SQLite integrity, creates
a **new isolated D1 database**, imports the sanitized restore and queries it again.
It does not replace the production database, publish the restored vault key or
start a second live worker.

Restored sessions are revoked, queued/running jobs are cancelled, invitations are
consumed, outbound email/push subscriptions are disabled and payment flows require reconciliation.
Historical payment transaction reservations are retained. Restore the vault key
separately to an isolated worker only after manual reconciliation; the drill
deliberately does not activate that worker.

The drill database is retained for inspection and consumes a free database slot.
`evidence/cloud-restore-upgrade.json` records actual completion; code existence
alone is not a completed cloud restore.

On 2026-11-03 a real live encrypted snapshot was restored to
`flashfirm-drill-mw0i4z6n`. Local integrity/foreign-key checks passed and all
21 business tables were read back from D1 and matched by canonical row hashes
after the additive push migration, including its two empty new tables.
The remote API refused `PRAGMA integrity_check`, so remote validation uses all
business row contents rather than claiming that remote pragma succeeded.
The test database remains isolated; production was not replaced. A failed
post-import check can be resumed **read only** with `--database=<drill-name>`
and `--readback-from=.runtime/offsite-backup/<original-drill-directory>`;
a nonempty database is never overwritten by an import retry.

## Confidential material boundary

`confidentialQuotationSession` first obtains a fresh task/nonce-bound
attestation, fetches the hardware verdict and exact quote bytes directly from
Phala, verifies exact Compose and platform measurements, and requires an
independent signed secret-release approval. Only then does it encrypt and
send the actual task to the attested X25519 key. Responses are decrypted,
signature-checked, task-bound and locally replayed. A session is single-use.

The approval binds `taskRoot`, `reportHash`, `taskDigest`, endpoint, exact
Compose/app ID, MRTD/RTMR0/1/2, audit hash and expiry. It explicitly allows only
private quotation checks and forbids a model-inference claim. No such production
approval has been supplied. Tests use a clearly synthetic hardware service.

The real Phala instance remains off. No private material has been submitted to
it, and remote commercial-model calls are **not** trusted enclave inference.
Actual measured model weights/runtime, inference execution and a full private
task remain external validation work.

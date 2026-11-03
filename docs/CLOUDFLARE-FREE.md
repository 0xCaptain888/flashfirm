# Cloudflare free backend

Status: **publicly deployed and verified on 2026-11-03** at https://flashfirm-api.fluoridated-rhinoceros.workers.dev/. The account dashboard showed Workers Free as the current plan. No plan upgrade or billing enrollment was performed. [Public test evidence](../evidence/cloudflare-deployment.json). This is a separate cloud workspace, not a transparent migration of the existing local database.

## Open your workspace

Open the URL above. Copy the access token from the private local file `.runtime/cloudflare/captain-token.txt`, paste it into **Operator token**, and click **Unlock workspace**. Do not paste the token in chat or publish it. The initial token expires at **2026-11-04 09:32 Asia/Shanghai**; reissue it through the operator after expiry.

Create a named workspace, then click **Verify recorded AI receipt**. Open the completed job to inspect the result; refresh/reopen to read the same D1 history. The report's signature is valid while its original quality state remains **CHALLENGED**. A completed verification does not certify a good report or trigger payment. The cloud does not spend the remaining local model budget.

The dedicated deployment test workspace was closed, its disposable encrypted note removed, and its test token revoked. Its completed verification and audit metadata are retained.

## What the user needs to do

1. Log in to your own Cloudflare account in Chrome; complete any human verification yourself.
2. Authorize the narrowly scoped Wrangler login opened by the deployment operator: account/user read, Workers write, Workers scripts write, D1 write. Refresh access is added by Wrangler. No email, connectivity administration, paid AI, containers, or zone-management scope is needed.
3. Stay on the Workers Free plan. No upgrade, billing enrollment, domain purchase or paid add-on is part of this deployment.

The operator handles database creation, migrations, encryption secret provisioning, Worker deployment, workspace-token issuance and live smoke verification after login. Never send account passwords, API keys or wallet keys in chat.

## Implemented in this cloud variant

- D1 owner-scoped workspaces, expiring/revocable hashed bearer tokens and immutable idempotency keys.
- Encrypted receipt inputs and notes using a separately provisioned Worker secret. This is not TEE; the service operator can decrypt.
- Workflows verify existing signed reports, persist results and never execute financial transfers or paid model calls. A repeated workflow step only repeats deterministic free verification; its terminal D1 update is fenced against workspace closure.
- Dispatch errors retain a queued job. POST the same input/idempotency key or explicitly call `POST /api/workspaces/:firm/jobs/:job/resume`; it uses the same workflow instance ID. Never create a new request key merely because a response was lost.
- Pinned review policies, signed decisions, appeals and resolutions with optimistic revision checks; conflicting concurrent updates must reload rather than overwrite.
- Closed workspaces cancel queued work and delete active notes. Historical audit metadata remains; this is not certified data erasure.
- App-level limits: 60 authenticated requests per owner/minute; globally, 500 write attempts and 100 verification submissions per UTC day; 50 workspaces per owner, 100 jobs and 20 notes per workspace. Cloudflare platform free limits still apply. These app limits are not a financial billing cap on an already-paid Cloudflare account.

Paid model execution is deliberately unavailable. The UI displays an explicitly recorded snapshot of the existing local ledger (10/12 calls, CNY 15.91/20 reserved), never a new spend allowance. No provider secret or wallet key is uploaded. To enable cloud model work later, first design an authoritative shared budget and reconcile all existing reservations; do not independently enable two ledgers.

The subsequent [task dossier upgrade](TASK-DOSSIERS.md) adds immutable encrypted
report attachment, exact source locations, bound signed review rounds, portable
exports and persistent in-app acknowledgements. It also verifies signed editorial
revisions as free background jobs without treating them as newly approved model
outputs. Apply additive migration `0002_task_cases.sql` before deploying this
version. No existing workspace, note or token is deleted by that migration.
The deployed upgrade passed real remote verification with a disposable test
owner; evidence is in `evidence/cloudflare-case-upgrade.json`. The public script
never uses the captain token, invokes a model or transfers funds. The D1 export
endpoint returned an authentication error under the current narrow OAuth scope;
do not present this deployment as having a validated cloud backup/restore drill.

Not ported: reviewer account-binding registry, TEE/OpenSSL verification, destination-chain receipt registry, full local database/history, organization login and a production backup/restore process. Their existing local implementations are preserved. D1 persistence is not proof of an offsite recovery drill.

## Reproduce the local check

From the repository root, on a fresh local emulator state:

```sh
npm ci --prefix cloudflare
node scripts/build-cloud-assets.mjs
npm --prefix cloudflare run check
node cloudflare/node_modules/wrangler/bin/wrangler.js d1 migrations apply flashfirm-free --local --config cloudflare/wrangler.jsonc
node scripts/prepare-cloud-local.mjs
node cloudflare/node_modules/wrangler/bin/wrangler.js d1 execute flashfirm-free --local --config cloudflare/wrangler.jsonc --file .runtime/cloudflare/local-test-token.sql
npm --prefix cloudflare run dev
```

In another terminal: `node scripts/check-cloud-local.mjs`. Credential preparation refuses overwrite so an existing encryption key cannot be accidentally replaced. `.runtime`, `.wrangler`, `.dev.vars` and tokens are ignored by Git. Local smoke test creates and closes only a test workspace, verifies the actual published signed receipt, and asserts duplicate submissions return the same job.

## Deployment operator checklist

After narrowly scoped login, inspect the selected account and confirm Free billing. Create a dedicated `flashfirm-free` D1 database; replace the all-zero placeholder in `cloudflare/wrangler.jsonc` with its returned public database ID. Do not reuse another project's database.

```sh
node cloudflare/node_modules/wrangler/bin/wrangler.js d1 create flashfirm-free
# Update database_id before the following commands:
node cloudflare/node_modules/wrangler/bin/wrangler.js d1 migrations apply flashfirm-free --remote --config cloudflare/wrangler.jsonc
node scripts/build-cloud-assets.mjs
```

Generate a new production AES-256 key privately and provision it as `VAULT_KEY` with `node scripts/cloud-vault.mjs`. It uses Wrangler stdin, preserves `.runtime/cloudflare/production-vault.key` as a private backup, and reuses that exact key on retry. Do not deploy the local `.dev.vars` key, print the key, commit it, or replace it after storing documents. Keep a recoverable private copy under operator control. Deploy the worker with `npm --prefix cloudflare run deploy`. Workflows may require a further narrowly scoped permission if the account's API rejects the current scopes; do not substitute a blanket account token.

Generate an expiring token with `node scripts/cloud-token.mjs captain`. Apply only `.runtime/cloudflare/captain-token.sql` remotely using `wrangler d1 execute`; it contains a hash, not the bearer token. Give the user the local private token-file path. No shared token belongs in public Pages, source code or the demo video. Revoke a token by updating its `revoked` column. Token rotation must preserve the encryption secret.

Verify the returned `workers.dev` endpoint: healthy database, rejected unauthenticated requests, one authorized workspace write, one completed workflow receipt check, duplicate prevention, and successful reload after a separate request. These checks passed for the deployed endpoint; `scripts/check-cloud-live.mjs` records them using a dedicated test token, never the user's token. Revoke each test token after its run. Monitor the Free dashboard and stop at limits instead of enabling paid overages.

Official references consulted: Cloudflare Workflows Workers API, D1Database batch API and Wrangler configuration documentation. Local package and lockfile pin the tested Wrangler version.

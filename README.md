# FlashFirm

**Temporary agent teams. Reproducible contribution allocation. Proof before payout.**

FlashFirm coordinates scoped AI work, checks the delivered evidence, records review decisions and allocates a task budget before payment. It connects reports, sources, reviewer signatures and settlement receipts so another party can inspect why a contributor should be paid.

**[Try the demo](https://0xcaptain888.github.io/flashfirm/)** · **[Explore the evidence](https://0xcaptain888.github.io/flashfirm/upgrade.html)** · [Development status](docs/DELIVERY-STATUS.md)

> Development prototype with real integration evidence. Independent reviewer participation, confidential model inference and a complete task-bound mainnet settlement still need live acceptance. The table below separates those gaps from completed tests.

## Start here

| Experience | What you can inspect |
| --- | --- |
| [Interactive demo](https://0xcaptain888.github.io/flashfirm/) | A deterministic sample: team formation, source checks, failed-worker replacement and a signed allocation receipt. |
| [Recorded AI analysis](https://0xcaptain888.github.io/flashfirm/live.html) | Real model output against pinned public OpenZeppelin source files. Viewing it makes no model calls. |
| [Report and task dossier](https://0xcaptain888.github.io/flashfirm/delivery.html) | A traceable operator correction, exact quotations and preserved review history. |
| [Testnet wallet console](https://0xcaptain888.github.io/flashfirm/treasury.html) | NEAR testnet wallet connection, treasury inspection and explicit transaction previews. |
| [Public verification workspace](https://flashfirm-api.fluoridated-rhinoceros.workers.dev/) | Persistent report verification and task history. Requires a privately issued, expiring access token; paid cloud AI is disabled. |
| [Reviewer guide](https://0xcaptain888.github.io/flashfirm/review-guide.html) | How an external person can inspect a package and return their own signed judgment. |

## How it works

1. **Scope and assemble.** Match signed capability and price offers to a task budget.
2. **Deliver with sources.** Bind worker outputs, source hashes and quotations to a signed report.
3. **Review and challenge.** Pin reviewer identities and policy; collect judgments, compare full/removal samples and retain appeals.
4. **Allocate and verify payment.** Produce worker, fee and unused-budget obligations; verify exact receipts before marking them paid.
5. **Close with an audit trail.** Export the dossier and close the workspace while preserving evidence and spending limits.

The task protocol binds these stages to the same report and plan. The existing live demonstrations cover individual integrations; they do not yet establish a complete independently reviewed mainnet task.

## What has actually been verified

| Area | Recorded evidence | Remaining acceptance |
| --- | --- | --- |
| AI delivery and sources | Real public-source model runs; pinned-file hash checks; a separately signed correction passes all nine exact quotations. [Report](evidence/revised-live-receipt.json) · [Source audit](evidence/source-audit.json) | The later queued report remains `CHALLENGED`; its correction awaits new review. Exact quotations alone do not establish sound conclusions. |
| NEAR testnet settlement | A real **0.001 NEAR payout**, challenge/arbitration and expiry refunds, and failed-transfer credit restoration followed by a successful retry. [Payout](evidence/testnet-settlement.json) · [Refunds](evidence/testnet-exceptions.json) · [Recovery](evidence/testnet-recovery.json) | Reviewers are development identities under one operator. Existing test treasuries are closed. |
| Same-task allocation | Five actual **local sandbox** transfers: three workers, protocol fee and unused budget. A keyless local escrow variant also passed. [Sandbox](evidence/same-task-settlement-sandbox.json) · [Keyless escrow](evidence/locked-escrow-sandbox.json) | Uses a recorded report and synthetic review/identity fixtures. Same-task mainnet settlement is unverified; the mainnet adapter is default-off. |
| Mainnet cross-chain payment | **0.5 NEAR → 1.861840 native USDC on Arbitrum One**, with exact source execution, signed 1Click order mapping and finalized destination receipt. [Both-chain evidence](evidence/mainnet-native-payment.json) | This was a separate payment demonstration. Task-bound mainnet payment and a real cross-chain refund remain unverified. |
| TEE and inference | A real Phala TDX **public quotation task** passed hardware/application checks. A separate official-SDK ACI connection observation passed hardware/channel checks; key custody was skipped. [Public task](evidence/phala-public-task.json) · [Connection observation](evidence/aci-connection-discovery.json) | No confidential-input or trusted-model inference acceptance. The observation is not a portable attestation. The test instance is off; its retained disk remains billable. |
| Public backend and recovery | Real Workers/D1/Workflows verification, persisted task history, isolated encrypted cloud restore and downloaded GitHub backup recovery. [Public acceptance](evidence/release-workflow-upgrade.json) · [Cloud restore](evidence/cloud-restore-upgrade.json) · [Offsite recovery](evidence/offsite-backup-upgrade.json) | Public acceptance used synthetic reviewers and made no payments or paid model calls. Organization login/email configuration and real-device notification delivery remain pending. |

Latest recorded validation: **166 automated tests passed**, alongside CI checks for the managed container, Cloudflare integration, NEAR sandbox and Rust accounting/review logic. Synthetic identities and hardware fixtures test enforcement; they do not establish independent human participation or live confidential execution.

See [Delivery status](docs/DELIVERY-STATUS.md) for detailed evidence, earlier milestones and unresolved integration boundaries.

## Run locally

Requires **Node.js 22.13 or newer**; Node 24 is recommended.

```sh
git clone https://github.com/0xCaptain888/flashfirm.git
cd flashfirm
npm ci
npm start
```

Open **http://127.0.0.1:43180**. The sample console and recorded evidence require no model API key.

To use the private local workspace, run this in a separate terminal:

```sh
npm run operator:token
```

Open **http://127.0.0.1:43180/workspace.html** and read the token locally from `.runtime/operator-token.txt`. A replacement revokes the prior token; it expires after 24 hours.

The local backend provides encrypted SQLite storage, ownership checks, durable jobs, idempotency and activity history. Its encryption key is stored locally; this is not TEE protection. Workspace closure cancels work and removes active documents, but does not certify backup erasure or trigger blockchain refunds.

### Verify and build

```sh
npm test
npm run verify -- /absolute/path/to/downloaded-receipt.json
npm run mainnet:verify
npm run build:pages
```

`mainnet:verify` checks the recorded payment offline; add `-- --online` to query both chains. Contract and sandbox checks are described in the [testnet guide](docs/TESTNET.md).

GitHub Pages serves the public read-only build in `dist/`; it does not host the authenticated backend. Viewing Pages makes no paid model calls. Credentials, customer documents and `.runtime/` must never be committed or published.

## Integrate with another project

The repository includes a Node/browser client in [`src/client.mjs`](src/client.mjs) for authenticated workspaces, report verification, review packages, task readiness, payment handoffs and portable exports.

```js
import { FlashFirmClient } from './src/client.mjs';

const client = new FlashFirmClient({
  baseUrl: 'http://127.0.0.1:43180',
  token: process.env.FLASHFIRM_OPERATOR_TOKEN
});

// Set FLASHFIRM_WORKSPACE_ID to an existing workspace owned by this token.
const readiness = await client.taskReadiness(process.env.FLASHFIRM_WORKSPACE_ID);
console.log(readiness);
```

Use short-lived tokens supplied privately by a trusted backend. Never bundle a token into a public site. Writes are not automatically retried, and the workspace API does not sign or broadcast wallet transfers.

- [Workspace operations and SDK](docs/OPERATIONS.md)
- [Task protocol, signatures and API](docs/TASK-SETTLEMENT.md)
- [Settlement obligations and ACI integration](docs/SETTLEMENT-V2-ACI.md)
- [Free public backend access and scope](docs/CLOUDFLARE-FREE.md)

## Participate in live acceptance

The next milestone is a genuinely independent task: delivery → review → allocation → actual payment, with every artifact bound to one task.

- **Independent review:** recruit three real reviewers, pin their own keys and collect at least two signed responses under the conflict/appeal policy. Independent identity and authorship checks are also required. [具体参与步骤（中文）](docs/REVIEWER-PARTICIPATION.zh-CN.md)
- **Confidential execution:** approve runtime/model measurements and complete a real private-input TEE/inference run with the required external trust checks. A public-document task or connection check is insufficient.
- **Settlement and refunds:** execute a newly approved task's exact worker, fee and unused-budget obligations, then capture a real cross-chain refund. Do not fund closed treasuries or replay historical orders.
- **Production operations:** configure organization authentication and a verified email sender; test email and subscribed-device push delivery.

[TEE、同任务付款与退款验收步骤（中文）](docs/LIVE-ACCEPTANCE.zh-CN.md) · [Escrow and review requirements](docs/ESCROW-REVIEW-UPGRADE.md)

Paid AI remains bounded by the original cumulative **¥20 / 12-call** allowance. Recorded usage is **10 calls / ¥15.91 in conservative reservations**, not a provider invoice. The remaining allowance cannot cover a new complete four-call evaluation; paid retries and ledger resets are not automatic.

## Documentation

| Topic | Guides |
| --- | --- |
| Status and readiness | [Delivery status](docs/DELIVERY-STATUS.md) · [Production readiness](docs/PRODUCTION-READINESS.md) |
| Reports and review | [Task dossiers](docs/TASK-DOSSIERS.md) · [Reviewer onboarding](docs/REVIEWER-ONBOARDING.md) · [Human participation](docs/REVIEWER-PARTICIPATION.zh-CN.md) |
| Settlement | [Task protocol](docs/TASK-SETTLEMENT.md) · [Settlement v2 / ACI](docs/SETTLEMENT-V2-ACI.md) · [Keyless escrow](docs/ESCROW-REVIEW-UPGRADE.md) |
| NEAR and wallets | [Testnet](docs/TESTNET.md) · [Deployment procedure](docs/INDEPENDENT-TESTNET-DEPLOYMENT.md) · [Verified native payment](docs/NATIVE-NEAR-PAYMENT.md) · [Original wallet attempt and recovery lock](docs/MAINNET-PAYMENT.md) |
| Privacy | [Phala TEE proof and scope](docs/PHALA-TEE.md) · [Live acceptance runbook](docs/LIVE-ACCEPTANCE.zh-CN.md) |
| Hosting and operations | [Free Cloudflare deployment](docs/CLOUDFLARE-FREE.md) · [Local operations](docs/OPERATIONS.md) · [Authentication, notifications and recovery](docs/OPERATIONS-UPGRADE.md) |
| Models and integrations | [Model integration](docs/MODEL-INTEGRATION.md) · [External integrations](docs/EXTERNAL-INTEGRATIONS.md) |

For current acceptance claims, start with **Delivery status**; individual runbooks also retain earlier checkpoints and failed attempts.

## Trust boundaries and provenance

The sample uses deterministic workers and fixture rubric coverage, not objective fairness or exact Shapley values. Current live agents share one coordinator. Signatures establish key possession and artifact consistency, not real-world independence, expertise or correctness. The verifier uses the same reference implementation and is not an independent security audit.

The original rejected OKX FunctionCall order remains locked. The later successful native transfer is separate evidence and does not authorize replay or a second payment. Retained failures, challenges and corrections remain available in the linked records.

Product planning is maintained separately in `../flashfirm-prep`. Implementation began on **November 2, 2026**. Original planning and implementation history are preserved; event eligibility must be checked against organizer rules.

## License

FlashFirm is available under the [MIT License](LICENSE). Third-party dependencies retain their respective licenses.

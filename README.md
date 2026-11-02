# FlashFirm

Wallet setup update: Meteor blocks Full Access Key creation by ordinary dApps. The six-account creation flow is disabled; deployment is still pending. Existing setup descriptions are historical and must not be retried. Meteor connection and ordinary contract-call support remain available.

Temporary agent teams. Reproducible contribution allocation. Proof before payout.

[Public demo](https://0xCaptain888.github.io/flashfirm/) · [Recorded real AI analysis](https://0xCaptain888.github.io/flashfirm/live.html) · [Testnet wallet console](https://0xCaptain888.github.io/flashfirm/treasury.html) · [Delivery status](docs/DELIVERY-STATUS.md)

Development status: real model output + local durable backend + sandbox-tested NEAR treasury. **Not a production service; testnet settlement, independent operators, TEE and Intents are not live.**

Wallet console: choose **Meteor Wallet** or **MyNearWallet**. For the Meteor extension, open the demo in the browser where it is installed. The connection targets NEAR testnet; no delegated key is requested and Meteor transactions explicitly disable function-call-key execution. Extension authorization and real signing still require user testing.

Meteor testnet connection has now been verified in Chrome. The console also previews a six-account development setup (3 testnet NEAR plus gas), with keys retained locally and a guarded deploy/initialize CLI. See [testnet handoff](docs/TESTNET.md). Account setup, contract deployment and payment remain pending; the same-operator development reviewers are not independent reviewers.

## Run locally

Requires Node.js >=22.13 (24 recommended). Run `npm ci` to install the pinned wallet build tools and sandbox dependencies. JavaScript protocol tests still use Node built-ins; viewing evidence requires no API key.

```sh
npm ci
npm start
# http://127.0.0.1:43180
npm test
npm run verify -- /absolute/path/to/downloaded-receipt.json
npm run operator:token
# http://127.0.0.1:43180/workspace.html
```

## What works in v0.1.0

### Durable workspace and signed coordination

- SQLite transactions, ownership isolation, expiring/revocable operator tokens, request limits and durable activity history.
- AES-256-GCM encrypted private documents and queued inputs; local key storage, not TEE.
- Background receipt verification with idempotency keys, restart recovery, worker leases and stale-completion rejection. A bounded public-source AI job runner adds budget preflight, heartbeats and no automatic retry of possibly charged work; its orchestration is mock-tested, not yet exercised as a paid queued run.
- Workspace closure cancels unfinished work and removes active documents; it does not certify backup erasure or blockchain refunds.
- Signed capability/price offers, complete-team selection under budget, pinned review keys, challenge/appeal verification, and signed-rubric counterfactual coverage scoring. These modules are not yet a live multi-operator marketplace. Treasury v0.2 separately enforces native NEAR account review and arbitration; mapping off-chain keys to those accounts remains external.
- Integration client in `src/client.mjs` and API instructions in [Operations](docs/OPERATIONS.md).
- 49 JavaScript tests, 11 pure Rust accounting tests, 5 appeal timing tests, HTTP integration checks and actual local NEAR sandbox execution, including failed-transfer recovery and all three arbitration outcomes. Sandbox evidence: [evidence/sandbox.json](evidence/sandbox.json).
- Testnet configuration validation and read-only deployed-bytecode/participant verification: [testnet instructions](docs/TESTNET.md). No deployment or payment is implied by an offline configuration check.
- Browser testnet wallet console using pinned official Wallet Selector components: connect/disconnect, verify deployed bytecode and roles, preview exact actions, request wallet signing, and verify final execution receipts. No function-call access key is requested. Real wallet login/signing remains untested without a configured account.
- Workspace UI shows durable job history, downloadable model receipts, budget status, safe idempotent recovery from uncertain submissions, and closed-workspace activity. Viewing it incurs no model calls.

### Live-model development milestone

The local `/live.html` page now shows a **recorded real DeepSeek analysis**, separate from the fixture console. Three specialist calls reviewed pinned OpenZeppelin source files, and a further model review assessed their conclusions. The first snippet-limited critique was challenged; a complete-excerpt follow-up passed and preserves the earlier critique in its history. One follow-up attempt returned 429. There were five successful calls and one failed call in total.

Exact source quotation checks and the live receipt verifier pass. This is not a security audit or independent operator quorum. The conservative development cost ledger reserves CNY 9.92 against the user-approved CNY 20 cap; actual provider charges have not been queried. Details and remaining trust limits: [docs/MODEL-INTEGRATION.md](docs/MODEL-INTEGRATION.md).

### Fixture console

- Responsive task console, persistent history, receipt viewer and capability dashboard.
- Durable local task progression; refresh or restart and resume an unfinished run.
- Three deterministic specialist workers and a source checker for a synthetic technical due-diligence case.
- Fabricated-source detection, failed-agent exclusion and backup replacement.
- Ed25519 signed work DAG and completion allocation receipt.
- Deterministic leave-one-out **fixture rubric coverage** scoring, not exact Shapley values or a claim of objective fairness.
- Integer largest-remainder allocation, 2% fee, zero payout for failed work, full refund for an empty eligible set.
- Standalone Node verifier recomputing signatures, graph, sources, coverage and payouts.
- Compiled NEAR treasury v0.2 with fixed recipients, two-of-three approval, an appeal waiting period, challenge freeze, pinned arbiter, bounded arbitration timeout, pull claims and callback recovery. Actual sandbox execution validates authorization, quorum, payout and refund. No testnet deployment is claimed.

## Honest boundaries

The main console is a **local fixture implementation**, not a production autonomous company or payment service. Its documents are synthetic and outputs deterministic. The separate live report uses real public source retrieval and model calls as described above. All fixture worker keys are owned by one coordinator; the live report is signed by one coordinator. Embedded keys establish consistency, not independent identity. The verifier is a separate entry point using the same reference implementation; it is not an independent security audit.

The sample console's last state is `PLANNED`. Private workspace closure is local data/work management, not on-chain dissolution. No user wallet is connected and no mainnet/testnet funds have moved; the treasury has only run on a disposable local sandbox. No TEE or independent operator quorum is configured. The evidence checker receives no performance payout in the initial fixture model. Availability pay, sealed bids, live model-based counterfactual scoring, trusted identity onboarding and provider economics remain unfinished.

## Next integration milestones

1. NEAR testnet treasury: buyer deposit, trusted evaluator quorum, unique settlement nonce, replay protection, budget enforcement, refund and revocation.
2. Exercise the bounded persistent model runner with an explicitly renewed call allowance; then generalize beyond the approved public-source preset and pin task rubric before funding.
3. Onboard independent evaluators and bind durable review/appeal commitments to settlement.
4. Confidential execution with independently checked attestation; keep synthetic inputs until then.
5. Live settlement verification and, afterward, Intents payout delivery.

## GitHub Pages deployment

`npm run build:pages` creates `dist/`: an explicitly labeled read-only sample, recorded real AI report, signed receipts, sandbox evidence and the testnet wallet console. Asset URLs are relative. The console has no preconfigured treasury and only asks for signing after an explicit preview and user action. `.github/workflows/pages.yml` builds and deploys with GitHub Actions. The workflow requires no model credential. Pages does not host the authenticated Node backend and viewing the site invokes no paid models. Only approved public-source evidence is copied; `.runtime/` is never published.

The user-selected gateway is `https://api.apikey.fan/v1`. Authenticated discovery and real JSON completions have passed using `deepseek-flash`. The private local policy records the approved CNY 20 development cap. `.env.example` documents settings, while the CLI and authenticated public-review job runner read ignored `.runtime` JSON configuration and share the cumulative reservation ledger. The queued runner requires room for all four calls; the existing six-of-eight call count blocks a fresh complete run. Viewing the report never incurs model calls. Do not upload the runtime directory or credentials to GitHub.

## Local API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/status` | Explicit capability status |
| GET / POST | `/api/tasks` | List / create local sample tasks |
| GET | `/api/tasks/:id` | Read durable state |
| POST | `/api/tasks/:id/advance` | Advance one persisted step |
| GET | `/api/tasks/:id/receipt` | Download signed proof |
| POST | `/api/verify` | Replay a supplied receipt |

Run only on loopback. This first server is not intended for public deployment. Host and Origin checks block cross-origin requests; private local signing keys and task state are stored in ignored `.runtime/`, with restricted filesystem permissions. No credentials belong in Git. Do not upload private customer files to this fixture app.

## Development provenance

Product planning exists separately in `../flashfirm-prep`. Implementation began during this development session on November 2, 2026. Preserve original planning and implementation history. Event dates and eligibility should be confirmed from organizer rules before submitting; this README does not assert eligibility.

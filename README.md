# FlashFirm

Temporary agent teams. Reproducible contribution allocation. Proof before payout.

## Run locally

Requires Node.js 22 or newer. No package installation or API key required.

```sh
npm start
# http://127.0.0.1:43180
npm test
npm run verify -- /absolute/path/to/downloaded-receipt.json
```

## What works in v0.1.0

- Responsive task console, persistent history, receipt viewer and capability dashboard.
- Durable local task progression; refresh or restart and resume an unfinished run.
- Three deterministic specialist workers and a source checker for a synthetic technical due-diligence case.
- Fabricated-source detection, failed-agent exclusion and backup replacement.
- Ed25519 signed work DAG and completion allocation receipt.
- Deterministic leave-one-out **fixture rubric coverage** scoring, not exact Shapley values or a claim of objective fairness.
- Integer largest-remainder allocation, 2% fee, zero payout for failed work, full refund for an empty eligible set.
- Standalone Node verifier recomputing signatures, graph, sources, coverage and payouts.
- NEAR treasury contract source with fixed recipients, two-of-three approval, pull claims, failed-transfer recovery and expired-task refunds. Nine pure Rust accounting tests cover the core; deployment and SDK sandbox validation remain pending.

## Honest boundaries

This is a **local fixture implementation**, not a production autonomous company or payment service. Source documents are synthetic and public. Agent outputs are deterministic, not live LLM calls. All worker keys are owned by one coordinator. Embedded keys establish consistency, not independent identity. The verifier is a separate entry point using the same reference protocol implementation; it is not an independent security audit.

The last state is `PLANNED`, not `SETTLED` or `DISSOLVED`. No wallet is connected, no real funds are held or transferred, no NEAR contract is deployed, no TEE exists, and no independent evaluator quorum is configured. The evidence checker receives no performance payout in this initial coverage model. Availability pay, sealed bids, live AI scoring, trusted identity registry and provider economics remain unfinished.

## Next integration milestones

1. NEAR testnet treasury: buyer deposit, trusted evaluator quorum, unique settlement nonce, replay protection, budget enforcement, refund and revocation.
2. Real specialist adapters with validated structured outputs and source retrieval; pin task rubric before funding.
3. Bind an external evaluator allowlist to each task; refuse self-appointed evaluator keys.
4. Confidential execution with independently checked attestation; keep synthetic inputs until then.
5. Live settlement verification and, afterward, Intents payout delivery.

## API

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

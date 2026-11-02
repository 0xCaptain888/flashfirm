# Delivery status — 2026-11-02

This checklist separates implementation, actual integration evidence and remaining work. Passing local tests does not complete an external integration.

| Requested capability | Implemented / verified | Still required |
| --- | --- | --- |
| Real AI collaboration | Real four-call queued run completed once, signed receipt verified; three specialists plus same-provider critique; exact citation gate retained CHALLENGED despite model PASS | Broader project presets/tools; revised delivery after the rejected quotation; no automatic paid retry |
| Automatic team formation | Capability/price matching, signed offers, budget-constrained selection | Real independent supplier offers and onboarding |
| Source verification | Pinned OpenZeppelin retrieval, exact quotation checks, critique history | General discovery, semantic entailment evaluation and larger real-data benchmark |
| Contribution scoring | Fixed rubric, signed coverage, leave-one-out values, duplicate artifact exclusion | Real counterfactual re-execution study and independent anti-Sybil identity assurance |
| Independent review | Pinned decisions/appeals and native NEAR quorum; new dual-signature report-key/account binding with fresh final-block access-key check | Real independent operators, live onboarding, identity/conflict checks and consumed-nonce registry |
| NEAR settlement | Original buyer payout plus real developer-funded challenge/arbitration refund and expiry refund; both new treasuries Closed with final successful claim callbacks | Failed-transfer restoration remains sandbox-only; one earlier expiry deployment was interrupted by RPC 429 and retained without replay; independent reviewers still absent |
| Privacy | Encrypted local jobs; experimental Nitro COSE/ES384, pinned AWS root, certificate chain, nonce/task/key and PCR verification code; negative/claim tests | Actual enclave image and workload, reviewed PCR allowlist, hardware attestation success test, private ingress and secret release; not live TEE |
| Cross-chain collection | Official 1Click dry-quote/status adapter, route/address limits, fail-closed recovery and ERC-20 final receipt verifier with tests | Official endpoint returned HTTP 521; no live quote or payment; chosen route, unique task-payment binding, independent delivery verification and explicit mainnet permission |
| Lifecycle and operations | Durable jobs, managed HTTPS-origin mode, authenticated owner APIs, health endpoint, graceful draining, encrypted backup/restore tests, Docker/Compose preparation | No cloud account; Docker unavailable locally, container not built/deployed; organization auth, external uptime alerts, scheduled off-host backups |

There is no mainnet authorization in this workflow. A `.near` account ID supplied by the user does not authorize switching a `.testnet` deployment plan to mainnet. Credentials, seeds and private runtime state are never copied to Pages.

The user explicitly increased the cumulative call cap to 12 while retaining the CNY 20 cap. Four new calls completed, bringing totals to 10 calls and CNY 15.91 in conservative reservations (not an invoice). Output limits were reduced to 1,000 tokens to fit a worst-case four-call preflight into the existing budget. A further four-call run is blocked by remaining budget/call limits; the ledger was never reset.

Upgrade evidence is in `evidence/integration-upgrade.json`, with the new signed report in `evidence/queued-live-receipt.json` and testnet refund hashes in `evidence/testnet-exceptions.json`. See `PRODUCTION-READINESS.md` for implementation boundaries and deployment prerequisites.

Authenticated workspace browser testing remains incomplete because automated approval review rejected using the privileged local operator token in the browser. Unauthenticated wallet-page loading and guards were checked. The test suite covers server storage, budget behavior and transaction composition without using that browser token.

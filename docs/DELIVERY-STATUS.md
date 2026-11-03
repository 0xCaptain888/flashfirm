# Delivery status — 2026-11-03

This checklist separates implementation, actual integration evidence and remaining work. Passing local tests does not complete an external integration.

Task dossier upgrade: an immutable signed-report case, exact quote locations,
bound review rounds, persistent in-app reminders, SDK endpoints and portable
exports are implemented in both Node and Workers. Local Workers/D1/Workflows and
an isolated browser identity passed import, persisted acknowledgement and
refresh/re-authentication checks. A signed operator revision restores the missing
Solidity comment prefix in one quotation, preserving the original report and
its CHALLENGED result. All nine revised quotations pass, but the revision is
AWAITING_NEW_REVIEW. Three real immutable source files were retrieved again and
their complete hashes matched; repeated evidence is flagged, not paid twice by
an invented score. [Workflow and scope](TASK-DOSSIERS.md).

The upgrade subsequently passed a real public Workers/D1/Workflows acceptance
run: exact report binding, revised-report workflow verification, duplicate
prevention, rejection of a different report, persistent read acknowledgement,
export re-verification, and closure with retained evidence.
See `evidence/cloudflare-case-upgrade.json`. It creates no independent reviewers,
task-bound TEE assertion or payment. D1's export endpoint rejected the existing
narrow OAuth authorization, so a complete cloud export/restore backup is not
claimed; the additive migration preserved existing tables and data.

Latest deployment: [a dedicated Phala container](PHALA-TEE.md) completed a real hardware/application-verified public quotation task and was then powered off. The [free public verification workspace](CLOUDFLARE-FREE.md) separately passed a real Workers/D1/Workflows write-and-verification check. A separately approved [real mainnet cross-chain transfer](NATIVE-NEAR-PAYMENT.md) sent 0.5 NEAR and delivered 1.861840 USDC on Arbitrum One, with final source execution and finalized destination receipt verified. The full Node integration modules remain separate: reviewer revocation/account-key rechecks, persistent TEE challenge consumption, destination observation/replay prevention and restore invalidation. See [integration guide](EXTERNAL-INTEGRATIONS.md). Independent people, confidential production TEE assurance and automatic task-bound mainnet payouts remain missing.

| Requested capability | Implemented / verified | Still required |
| --- | --- | --- |
| Real AI collaboration | Real four-call queued run completed once; original CHALLENGED report preserved; separately signed operator correction passes nine exact quotations and awaits new review | Broader presets/tools; real review of the revised delivery; no automatic paid retry |
| Automatic team formation | Capability/price matching, signed offers, budget-constrained selection | Real independent supplier offers and onboarding |
| Source verification | Pinned OpenZeppelin retrieval and repeat full-hash comparison, exact quotation locations, repeated-evidence flags, critique and correction history | General discovery, semantic entailment evaluation and larger real-data benchmark |
| Contribution scoring | Fixed rubric, signed coverage, leave-one-out values, duplicate artifact exclusion | Real counterfactual re-execution study and independent anti-Sybil identity assurance |
| Independent review | Pinned decisions/appeals and native NEAR quorum; dual-signature account binding; authenticated onboarding challenge API, owner-scoped persistent registry and atomic single-use nonce checks | Real independent operators, live signed onboarding and identity/conflict checks |
| NEAR settlement | Original buyer payout, challenge/arbitration refund, expiry refund, and real testnet failed-transfer credit restoration followed by successful retry; recovery treasury Closed | One earlier expiry deployment was interrupted by RPC 429 and retained without replay; independent reviewers still absent |
| Privacy | Encrypted local jobs; experimental Nitro verifier; real Phala TDX public quotation task with official hardware verification, encrypted ingress/result signatures, nonce/task/key binding, exact measured Compose and RTMR3 replay; public proof reproduces after instance shutdown | Independent OS/KMS/governance verification, confidential secret-release review, attested model inference and continuously operated production service remain required; user chose to retain the stopped, billable 20 GB disk |
| Cross-chain collection | Real 0.5 NEAR native deposit → 1.861840 native USDC on Arbitrum One; signed quote and relay identity/mapping, final source action and finalized destination Transfer verified; portable public evidence and read-only replay tool | Automatic task-bound payouts and independent refund verification; original FunctionCall wallet mismatch remains unresolved and its journal/signing lock preserved |
| Lifecycle and operations | Public Workers/D1/Workflows verification workspace; owner tokens, encrypted notes, persistent results and real public smoke check; separate Node container CI and local backup/restore tests | Full Node integration hosting; organization auth, external uptime alerts, scheduled off-host backups and cloud restore drill; paid cloud AI disabled |

The separate explicit authorization for one 0.5 NEAR mainnet demonstration, up to 0.1 NEAR extra storage/gas and $5 total fresh valuation, was consumed by the successful native transfer. It does not authorize a second payment, replaying the original ambiguous FunctionCall attempt, loosening action checks, resetting either journal or moving testnet task funds to mainnet. Earlier unchanged-balance and `PENDING_DEPOSIT` observations are preserved as history. See [payment recovery boundaries](MAINNET-PAYMENT.md) and [successful native payment](NATIVE-NEAR-PAYMENT.md). Credentials, seeds and private runtime state are never copied to Pages.

The Phala console initially rejected inline-source deployments, including request ID `97d611347f271bb2674907bca3275445`. Dedicated source-verifiable container packaging then succeeded in the same workspace. The real task passed at `2026-11-03T07:13:07.518Z`, and shutdown was confirmed with balance $4.99 and auto-topup disabled. The earlier failures and support ticket #1342 are retained; the scanner's original trigger is unexplained. [Real proof, reproduction and trust boundaries](PHALA-TEE.md). The public task does not establish confidential production readiness.

The user explicitly increased the cumulative call cap to 12 while retaining the CNY 20 cap. Four new calls completed, bringing totals to 10 calls and CNY 15.91 in conservative reservations (not an invoice). Output limits were reduced to 1,000 tokens to fit a worst-case four-call preflight into the existing budget. A further four-call run is blocked by remaining budget/call limits; the ledger was never reset.

Upgrade evidence is in `evidence/integration-upgrade.json`, with the new signed report in `evidence/queued-live-receipt.json` and testnet refund hashes in `evidence/testnet-exceptions.json`. See `PRODUCTION-READINESS.md` for implementation boundaries and deployment prerequisites.

The earlier privileged local operator browser check was rejected by automatic approval review. This upgrade uses a materially narrower, isolated local-smoke owner with no provider or wallet credentials. Actual browser checks verified report import, persistent notification acknowledgement and refresh/re-authentication recovery for that disposable workspace. This does not certify every workspace or wallet UI path.

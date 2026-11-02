# Delivery status — 2026-11-02

This checklist separates implementation, actual integration evidence and remaining work. Passing local tests does not complete an external integration.

| Requested capability | Implemented / verified | Still required |
| --- | --- | --- |
| Real AI collaboration | Three real specialist outputs, pinned public source retrieval, same-provider critique, signed report; persistent bounded job runner and UI | New queued paid-run validation within authorized budget; broader project presets and tools |
| Automatic team formation | Capability/price matching, signed offers, budget-constrained selection | Real independent supplier offers and onboarding |
| Source verification | Pinned OpenZeppelin retrieval, exact quotation checks, critique history | General discovery, semantic entailment evaluation and larger real-data benchmark |
| Contribution scoring | Fixed rubric, signed coverage, leave-one-out values, duplicate artifact exclusion | Real counterfactual re-execution study and independent anti-Sybil identity assurance |
| Independent review | Pinned identities, durable signed decisions/appeals; native NEAR quorum, challenge and arbiter gate | Independent operators and verified mapping between off-chain keys and NEAR accounts |
| NEAR settlement | Tested Wasm; real Meteor buyer funding/allocation; two test-role approvals; appeal wait; final 0.001 testnet NEAR payout and successful callback; treasury Closed | Independent reviewers; real testnet challenge/refund/failure-recovery cases (currently sandbox only). Browser RPC availability remains environment-dependent. |
| Privacy | Encrypted local documents/jobs, owner isolation and expiry/revocation | TEE deployment, vendor-root attestation verifier and measurement allowlist; encryption is not TEE |
| Cross-chain collection | No live implementation claimed | NEAR Intents adapter, chosen supported route, allowed destination, recovery and delivery proof |
| Lifecycle and operations | SQLite jobs/history, crash fencing, spending guards, local dissolution, Pages publication | Production identity/auth, public backend deployment, backups, monitoring and alert delivery |

There is no mainnet authorization in this workflow. A `.near` account ID supplied by the user does not authorize switching a `.testnet` deployment plan to mainnet. Credentials, seeds and private runtime state are never copied to Pages.

The current six-of-eight model call ledger blocks a new four-call review. Conservative reservations remain CNY 9.92 against a CNY 20 cap, not a verified bill. Renewing the allowance requires explicit approval; deleting a ledger is not a budget reset mechanism.

Authenticated workspace browser testing remains incomplete because automated approval review rejected using the privileged local operator token in the browser. Unauthenticated wallet-page loading and guards were checked. The test suite covers server storage, budget behavior and transaction composition without using that browser token.

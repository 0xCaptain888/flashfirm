# Single-task NEAR treasury — development implementation

Native NEAR only. Compiled and tested in a local NEAR sandbox. Not deployed to testnet/mainnet, audited, or connected to the sample USD ledger.

Each v0.2 contract holds one task. Initialize from its own deployment account with a fixed buyer, three distinct evaluators, fixed recipient allowlist (including buyer for refunds), task root, policy hash, deadline, distinct arbiter and appeal/arbitration windows (60 seconds to seven days each). Evaluators cannot be buyer or recipients. The buyer funds once and proposes one exact-conservation allocation. Two distinct evaluator accounts must approve the same plan hash. Quorum starts the appeal waiting period; recipients cannot claim immediately. Transfers are marked pending before scheduling; failed transfer callbacks restore credit; successful callbacks increment paid balance. The accounting phase closes only after every funded yoctoNEAR has been paid.

Before the appeal cutoff, any recipient (including buyer) or evaluator can lodge one challenge bound to the exact plan hash and reason hash. This blocks payment. Only the pinned arbiter may resolve that challenge: uphold permits payment after the original waiting period; reject enables an exact full buyer refund. An unanswered challenge enables refund after the fixed arbitration deadline. A task party can therefore freeze the plan; the protocol deliberately favors a bounded buyer refund when the arbiter is unavailable. Choose and disclose a responsive arbiter before funding.

An expired task without quorum also supports a full buyer refund. Ordinary expiry cannot confiscate approved, unchallenged recipient credits, and rejection cannot overwrite pending or paid transfers. The contract does not verify report semantics, signatures in off-chain work envelopes, or TEE attestations: native NEAR account approval is an explicit trust boundary. The policy hash commits a document but does not execute its JavaScript rules or prove a mapping from off-chain signing keys to NEAR accounts. Distinct accounts do not prove distinct operators. A closed accounting phase does not delete the account or revoke its deployment key.

Storage and gas must be funded separately before buyer funding. Keep contract account deployment-key authority documented. Do not use real funds before sandbox integration and a security review. The current unbounded lifecycle allows only one fixed-size plan, at most 16 recipients, and three evaluators.

```sh
# No network needed for accounting-model tests:
rustc --edition 2021 --test src/ledger.rs -o /tmp/flashfirm-ledger-tests
/tmp/flashfirm-ledger-tests
# From the repository root (Rust wasm target + recent Binaryen required):
npm run build:contract
npm ci
npm run test:sandbox
```

The build lowers compiler-generated instructions to WebAssembly MVP before sandbox execution; raw output from newer Rust toolchains was rejected by the sandbox. `artifacts/contract-build.json` pins the tested Wasm hash. Sandbox tests cover initialization authority, buyer funding, immutable exact allocations, wrong/duplicate approvals, private callbacks, transfer recovery, successful payouts, expired unapproved-task refunds and uphold/reject/timeout challenge paths. See `evidence/sandbox.json` for recorded coverage. Remaining: independent security review, production reserve policy, testnet wallet/deployment/payment proof, and authenticated mapping from off-chain signing identities to on-chain accounts. The v0.2 initialization and storage layout are incompatible with v0.1; use a fresh contract account, never redeploy over a funded v0.1 treasury.

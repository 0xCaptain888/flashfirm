# Single-task NEAR treasury — development implementation

Native NEAR only. Not deployed, audited, or connected to the sample USD ledger.

Each contract holds one task. Initialize from its own deployment account with a fixed buyer, three distinct evaluators, fixed recipient allowlist (including buyer for refunds), task root and deadline. Evaluators cannot be buyer or recipients. The buyer funds once and proposes one exact-conservation allocation. Two distinct evaluator accounts must approve the same plan hash. Recipients pull their credits. Transfers are marked pending before scheduling; failed transfer callbacks restore credit; successful callbacks increment paid balance. The accounting phase closes only after every funded yoctoNEAR has been paid.

An expired task without quorum supports a full buyer refund. Expiry cannot confiscate already approved recipient credits. The contract does not verify report semantics, signatures in off-chain work envelopes, or TEE attestations: evaluator approval is an explicit trust boundary. Distinct accounts do not prove distinct operators. A closed accounting phase does not delete the account or revoke its deployment key.

Storage and gas must be funded separately before buyer funding. Keep contract account deployment-key authority documented. Do not use real funds before sandbox integration and a security review. The current unbounded lifecycle allows only one fixed-size plan, at most 16 recipients, and three evaluators.

```sh
# No network needed for accounting-model tests:
rustc --edition 2021 --test src/ledger.rs -o /tmp/flashfirm-ledger-tests
/tmp/flashfirm-ledger-tests
# Full NEAR Wasm build (downloads near-sdk and transitive dependencies):
cargo build --target wasm32-unknown-unknown --release
```

Remaining validation: NEAR sandbox tests of account authorization, asynchronous failed transfer callbacks, storage reserve sufficiency, deployment initialization and real testnet settlement. Pure model tests do not prove the wrapper is safe.

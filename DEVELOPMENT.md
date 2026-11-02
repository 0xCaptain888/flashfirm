# Development checkpoint — 2026-11-02

## GitHub deployment preparation

- Added a GitHub Actions Pages workflow and static preview builder. Build and standalone receipt verification passed locally.
- Public preview is a build-time fixture, not the live Node application. No model secrets are included in the artifact; no paid calls occur during the build.
- Configured the non-secret gateway template for api.apikey.fan. Unauthenticated model discovery returned 401 API_KEY_REQUIRED; exact model support and credentials remain unverified.
- Still no remote repository or public Pages deployment has been created by this preparation step.

## Implemented and verified

- 13 JavaScript protocol tests pass, including 3,000 randomized allocation cases.
- 9 pure Rust treasury accounting tests pass.
- HTTP integration checks pass for success and recovery flows, durable readback, idempotent terminal advancement, receipt export, independent local replay, tamper rejection, invalid budgets and cross-origin write rejection.
- Browser checks: one-click recovery run reaches PLANNED; original failed worker receives zero; accepted allocations sum with fee to the sample budget; receipt verification passes; refresh preserves the completed task; Activity lists prior tasks.
- Server restart loaded previously saved tasks successfully. Keys and task data remain ignored in `.runtime/`.

## Blockers and unfinished work

- NEAR SDK Wasm build has **not** passed. Official crates.io metadata retrieval returned HTTP 403; Cargo attempted the configured `tuna` registry and stalled. Two stalled builds were stopped. The project-local CARGO_HOME attempt also selected the configured mirror. Do not claim the contract is compiled or deployed.
- Native NEAR treasury wrapper is written, but account authorization/callback behavior still needs NEAR sandbox integration tests.
- No funded NEAR testnet accounts or approved evaluator account list have been configured for this project.
- Live model workers, production source retrieval, confidentiality attestations, independent evaluator infrastructure, live settlement, Intents and public deployment are not implemented.
- The model is a single-task treasury with fixed participants. No on-chain contribution-quality adjudication is implemented.
- No GitHub repository was created or pushed in this development session.

## Next sequence

1. Restore a working Cargo registry path; compile Wasm and run actual NEAR sandbox authorization/callback tests.
2. Connect a testnet treasury with a buyer, three evaluator accounts and fixed recipients. Funding denominations must be native NEAR, never the sample USD label.
3. Add a real worker provider to the same evidence schema, retain immutable task/source manifests, and measure citation failures on non-synthetic tasks.
4. Implement independent evaluator approval and bind its identity set before funding.
5. Add wallet UI and verified payout receipts only after real transaction/state evidence is available.

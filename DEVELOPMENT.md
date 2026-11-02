# Development checkpoint — 2026-11-02

## Subsequent real model milestone

- User confirmed CNY 20 cumulative model development budget.
- Authenticated gateway discovery succeeded. The API alias is `deepseek-flash`; the gateway's own public metadata maps this to the user's requested V4-1-Flash-1017 version.
- Real pinned OpenZeppelin source retrieval plus three specialist model calls completed. Exact quotation checks all passed.
- An initial critique received limited snippets and raised potentially context-induced challenges. The receipt was archived, then full fetched excerpts were supplied for a new critique. One attempt returned 429; a bounded subsequent attempt passed. No analyst work was regenerated.
- Final task state is REVIEWED, with original critique history preserved. Five successful calls and one 429 failure; conservative reservations total CNY 9.92, actual invoice cost unqueried.
- Local `/live.html` renders recorded real results without paid browser calls. CLI verifier supports both fixture and live receipt versions.
- Automatic provider selection currently uses local candidate definitions and cost estimates, not a third-party bidding market. Independent operators, semantic/causal scoring, live NEAR payments and TEE remain pending.

Earlier entries below are retained as chronological checkpoints; this section supersedes their statements about model credential and live-worker availability.

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
# 2026-11-02 · Durable workspace and sandbox milestone

Current status supersedes earlier historical checkpoints above. Added SQLite-backed authenticated workspaces, encrypted documents/job inputs, leased idempotent background receipt verification, local dissolution and event history, signed provider offers, durable reviewer/appeal validation, and reviewer-attested counterfactual coverage scoring. These are local development capabilities, not a live independent provider market.

NEAR Wasm compilation succeeded after using a sparse registry override. Raw modern Rust Wasm failed sandbox deserialization; lowering to MVP using Binaryen fixed loading. The contract now passes actual sandbox authorization/quorum/payout/refund tests. No user funds or testnet accounts were used. Real AI outputs remain the existing five successful model calls; no extra model spending in this milestone.

Public Pages build now includes approved public-source live evidence, separately labeled fixture evidence, and sandbox results. Private operator browser login was blocked by automatic approval review; API integration tests passed, but authenticated browser interaction is not claimed verified.

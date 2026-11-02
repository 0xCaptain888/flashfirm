# Testnet handoff

## Wallet-funded deployment setup

The Meteor connection for `0xcaptain888.testnet` was observed successfully in Chrome on 2026-11-02. This is wallet connectivity evidence, not deployment/payment evidence.

Run `node scripts/prepare-wallet-deployment.mjs YOUR_ACCOUNT.testnet` once. This creates a protected ignored `.runtime/testnet-deployment/` directory. **Never upload `keys.json`.** The generated `setup-public.json` contains public keys and the exact six child account names; `config-public.json` contains the pinned treasury configuration. Existing keys are never replaced silently.

In the wallet console, upload only `setup-public.json` under step 0 and preview. Six transactions create NEW direct children of the connected buyer: treasury receives 2.5 testnet NEAR; three reviewers, arbiter and worker receive 0.1 each. Total is **3 testnet NEAR plus gas**. Each new child receives its own full-access development key held by the local operator. No key is added to the parent wallet. This enables development automation only; all reviewers are controlled by one operator. Account creation is not atomic across six transactions. Any cancellation, timeout or partial completion must be inspected before retrying; the browser records an attempt marker and does not replay it automatically.

After wallet authorization and creation:

```sh
node scripts/deploy-wallet-treasury.mjs verify-accounts
node scripts/deploy-wallet-treasury.mjs deploy
node scripts/deploy-wallet-treasury.mjs verify
```

The deployer verifies all six exact public keys, the tested Wasm digest, an empty code slot and storage reserve before submitting a self-signed deploy+initialize batch. An exclusive attempt journal blocks uncertain replay. A contract that already has code is never overwritten. Verification re-reads bytecode and pinned configuration at a final testnet block. Private keys are never printed, uploaded or needed by the browser. Scripts require direct access to the official testnet RPC; local RPC connectivity remains an environment dependency. These new deployment commands have unit/build validation, but no actual testnet setup/deployment has yet been authorized or executed.

Meteor support (2026-11-02): the wallet menu now defaults to Meteor Connect SDK 3.24.1, with MyNearWallet as an alternative. Open in the Chrome profile containing the Meteor extension. The SDK offers extension transport when detected; otherwise it offers Meteor Web. The target is always testnet. No `addFunctionCallKey` is requested; signing sets `useFunctionCallKey: false`. Mobile bridge and account transfers are disabled. Browser initialization, connection-choice popup and cancellation are checked; actual extension authorization and signing remain user-dependent. Dependencies pin patched nanoid/decode-uri-component; installation audit reports 16 low advisories and no moderate/high/critical advisories.

The treasury is compiled and sandbox-tested, but no testnet deployment is recorded. The preparation and verification tools do not sign, fund, deploy or call paid models.

## Browser wallet workflow

After `npm ci && npm start`, open `/treasury.html`. The same page is shipped with Pages. It uses official `@near-wallet-selector/core` and `@near-wallet-selector/my-near-wallet` 10.1.4, with explicit testnet configuration. Connect with My NEAR Wallet. No `contractId`/`createAccessKeyFor` is passed at login, and a detected delegated function-call key blocks signing until disconnected. The browser wallet account is not a private workspace login.

Upload the public configuration described below, then verify. The console checks the chain ID, final block freshness, tested bytecode hash, participants, task/policy commitments and timing at the same block. Pick an operation, enter the required public parameters and preview it. Signing rechecks the latest state and wallet account. Deposits are limited to 0.01 testnet NEAR in this UI, plus wallet gas. The contract has no equivalent deposit cap; this is a client-side development guard.

The wallet requests explicit signing; the application never runs a signature on page load. On return, use **Verify final execution**. It checks the exact signer, receiver, method, arguments, gas, deposit, finality and execution receipts. A `claim_for` must return a successful transfer callback. Failures or RPC timeouts never count as payment success. The exact pending intent is retained in this tab's session storage so a hash from wallet history can be checked after interruption. The tool does not automatically resend a transaction. It trusts the configured RPC, not a light-client proof.

The page and unconnected guards have been browser-checked; wallet authorization, real testnet signing and RPC integration remain unverified. The current local environment timed out reaching both official NEAR RPC endpoints. Do not interpret unit fixtures or local sandbox results as a live testnet transaction.

For connectivity diagnosis, run `node scripts/check-near-network.mjs PUBLIC_ACCOUNT_ID`, or dispatch **Read-only NEAR network check** from GitHub Actions with that public ID. It checks official endpoint chain identities and account existence on testnet/mainnet. It never prints balances, handles a key or creates a transaction. A mainnet account result does not authorize mainnet deployment.

Prepare a fresh named contract account, a buyer, a recipient, three evaluator accounts and a separate arbiter. For development these may be controlled by one tester only if that limitation is disclosed; this does not establish independent review. Keep storage/gas reserves separate from the task deposit. Never send a seed phrase or private key in chat.

Create an ignored `.runtime/testnet-config.json` with this shape, replacing every example account and commitment. Set `deadline_ns` to a future Unix time in nanoseconds encoded as a decimal string; the example below is deliberately not a usable deployment configuration.

```json
{
  "network": "testnet",
  "contractId": "treasury.example.testnet",
  "init": {
    "buyer": "buyer.example.testnet",
    "evaluators": ["review-a.example.testnet", "review-b.example.testnet", "review-c.example.testnet"],
    "recipients": ["buyer.example.testnet", "worker.example.testnet"],
    "arbiter": "arbiter.example.testnet",
    "task_root": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS",
    "policy_hash": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS",
    "deadline_ns": "REPLACE_WITH_FUTURE_UNIX_NANOSECONDS",
    "appeal_window_ns": "60000000000",
    "arbitration_window_ns": "60000000000"
  }
}
```

```sh
node scripts/prepare-testnet.mjs .runtime/testnet-config.json
# After wallet-authorized deployment and initialization:
node scripts/prepare-testnet.mjs .runtime/testnet-config.json --verify
```

Preparation rejects role overlap, non-testnet account names, unsafe integers and invalid timing. Initialize `new` from the deployment account with exactly `init`. Deploy only `artifacts/flashfirm_treasury.wasm` with its recorded SHA256. Do not initialize a funded older treasury or upload private runtime files.

Verification uses the testnet RPC, checks its chain ID, and reads account bytecode hash and `get_status` at the same final block. It compares bytecode and every pinned participant, task/policy commitment and timing value to the configuration. It exits nonzero on mismatch or query failure. This trusts the RPC response; it is not a cryptographic light client. A passing result proves neither a payment nor operator independence. Record actual transaction outcomes and balance/state changes separately before claiming settlement.

The remaining wallet workflow is: deploy and initialize; buyer funds with native testnet NEAR; buyer proposes exact allocation; two evaluators approve the returned plan hash; wait through the appeal period; claim for the fixed recipient and verify callback completion. Test challenges in separate disposable treasuries because one allocation/one challenge is immutable per task. Native account approvals remain distinct from the application's off-chain signed review records.

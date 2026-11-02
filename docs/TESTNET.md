# Testnet handoff

The treasury is compiled and sandbox-tested, but no testnet deployment is recorded. The preparation and verification tools do not sign, fund, deploy or call paid models.

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

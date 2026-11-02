# Independent testnet deployment

Latest milestone: the buyer subsequently signed funding/allocation in Meteor, two local test reviewers approved, and 0.001 testnet NEAR was paid after the appeal period. Treasury is now Closed. [Settlement evidence](../evidence/testnet-settlement.json) supersedes the initial Empty-state snapshot below. The two reviewers and worker each needed an additional 0.2 testnet NEAR gas reserve from the developer's faucet balance. The first review-a approval was rejected for insufficient balance before execution; its original attempt journal is preserved. No automatic retry of an uncertain submission was used.

Completed on 2026-11-02: developer `flashfirm-dev-0xcaptain888.testnet` received 10 testnet NEAR from the official faucet. Six roles received 3 testnet NEAR total; gas was paid from developer funds. `treasury.flashfirm-dev-0xcaptain888.testnet` was deployed and initialized in transaction `jQwtNfa6PRiYh6RB2GZC2J9NpHFDQ8RJDj8vjNit87C`. Final bytecode/configuration verification passed at block 275896150. Task funding and payment are still zero. No Meteor funds were used.

The implementation uses the official CLI's documented faucet request (`newAccountId`, `newAccountPublicKey`) through `scripts/independent-testnet-account.mjs`, and the installed NEAR SDK for deployment. The CLI binary was downloaded but not needed. Keys are in ignored `.runtime/independent-testnet/` (directory 0700, files 0600), not in the OS keychain. Public evidence is in `evidence/testnet-deployment.json` and `evidence/testnet-config.json`.

Recheck without sending transactions:

```sh
node scripts/independent-testnet-account.mjs verify
node scripts/deploy-independent-treasury.mjs verify
```

Do not rerun preparation, reset attempt journals, or overwrite keys. Provisioning verifies existing accounts and recovers final receipts without resending completed creations. Read-only RPC calls back off on HTTP 429. The SDK may refresh a nonce after a rejected nonce; ambiguous application-level submissions are fenced by attempt journals.

Meteor rejected the historical six-child Full Access Key request. Do not retry it, route it through another wallet, or use account recovery to evade the restriction. The old plan remains archived and does not establish a deployed treasury.

The independent route uses a new developer-owned testnet account created by the official NEAR CLI faucet service. It does not import the buyer's key or spend from `0xcaptain888.testnet`. The buyer can later approve ordinary contract calls in Meteor.

Official references checked on 2026-11-02:

- https://github.com/near/near-cli-rs/blob/main/README.md
- https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md#sponsor-by-faucet-service---i-would-like-the-faucet-service-sponsor-to-cover-the-cost-of-creating-an-account-testnet-only-for-now

## User-owned account creation

The official CLI can run with `npx near-cli-rs`. For a dedicated account (check availability first), the documented flow is:

```sh
npx near-cli-rs account create-account sponsor-by-faucet-service flashfirm-dev-0xcaptain888.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
```

This command is a prepared handoff, not an executed creation or proof of funding. Keep the generated key in the local system keychain. Do not paste keys, seed phrases or keychain exports into chat, Pages, logs or GitHub. Faucet availability and limits are external conditions; never substitute a buyer-funded transaction automatically.

## Deployment gates

1. Verify the new account, network, public key and balance at a final RPC block.
2. Prepare a new public role/configuration manifest. Preserve the archived six-account plan and its keys unchanged. Do not silently reuse its parent-account assumptions.
3. Preview any developer-account spending and account controls before provisioning the treasury and test roles. Same-operator roles remain explicitly development-only.
4. Deploy the tested Wasm and initialize atomically, signed by the treasury itself. The contract requires predecessor == current account for initialization. Never deploy over the buyer account or an existing contract.
5. Verify code hash and all pinned configuration, then test an explicitly approved small buyer deposit, quorum, appeal timing and fixed-recipient payout. Check final execution receipts and transfer callbacks.

No public deployment, independent review, or actual testnet settlement is claimed until these gates have evidence. The existing local deployment script expects the archived child-account layout and must not be pointed at a different account without updating and testing its configuration checks.

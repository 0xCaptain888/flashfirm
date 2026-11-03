# NEAR → Arbitrum mainnet payment console

This is one separately approved demonstration payment, not an automatic payout
from the NEAR testnet task treasury. The original Solana route was replaced by
the user's Arbitrum destination.

The policy in `src/mainnet-payment.mjs` pins the source account, refund account,
Arbitrum One chain ID, native USDC contract and recipient. Principal is exactly
0.5 NEAR, source gas/storage allowance at most 0.1 NEAR, and total source value
at most $5 using a fresh signed quote. Fees withheld from output are reflected
in that quote. Dollar valuation is a point-in-time quote, not a USD-denominated
on-chain spending limit.

## Actual evidence and current boundary

`evidence/mainnet-route-preview.json` is an actual dry quote captured from the
official service. Its signature verifies offline with the pinned official SDK.
The recorded output is historical and must not be used as a current price.
No deposit address was issued, transaction signed or funds moved in that record.
It is not payment evidence.

The local console now obtains and verifies live dry quotes. Official service
defaults are validated explicitly (public confidentiality, no insurance, zero
waiting delay and at most 25 bps in the default service-fee entry).

The OKX wallet display label is `0xcaptain888.near`, but the connected on-chain
account is the user-supplied implicit account
`0cd07d0982767b3b7abed80e489129be51df7300f0b2729a8f28f6eef3200606`.
Read-only mainnet RPC checks found funds in this implicit account and a zero
balance in the separate named account. Source and refund policies therefore
pin the implicit account; wallet labels never authorize a different signer.
An executable quote was saved, the account/storage/gas preflight passed and the
user approved the OKX signing prompt. The returned transaction failed the exact
action check (`SIGNED_ACTIONS_SUBSTITUTED`). No source hash was persisted and
the local service did not broadcast. The first rejected signed response was
not retained, so its exact field differences and hash cannot be reconstructed.
An independent check found the source balance unchanged and the matching relay
order still `PENDING_DEPOSIT`. These are observations, not proof that the wallet
never attempted broadcast.

Inspection of installed OKX 4.22.2 showed that its `signTransaction` handler
attempts to submit before returning signed bytes. Therefore post-signature
validation is insufficient to prevent extension-side submission. **Signing is
disabled in both the local service and UI pending a wallet compatibility fix.**
Do not retry, reset the journal or send a second deposit.
The read-only saved-order check verifies the official quote signature and
identity, then reads the finalized source balance. It never claims delivery.
Subsequent signed-response diagnostics retain decoded actions and their
cryptographically verified hash before an integrity error, without exposing
the signed bytes in public state.

## Start locally

```sh
npm ci
npm run mainnet:console
# Chrome: http://127.0.0.1:43186
```

For this workstation's existing localhost proxy, after installing the separate
Cloudflare dependencies:

```sh
FLASHFIRM_USE_SYSTEM_PROXY=1 npm run mainnet:console
```

The service binds only `127.0.0.1`, pins Host/Origin, requires an in-memory CSRF
token for every mutation, and does not expose CORS. Do not publish or reverse
proxy this console. It is not a hosted payment API.

## Wallet and order lifecycle

1. Connect the exact approved NEAR account using the OKX browser extension.
   Connection requests no contract delegation or access-key creation.
2. Get a dry quote. Verify its official Ed25519 signature, route and $5 budget.
3. Review the recipient and check the authorization checkbox. Reserve an
   executable quote; its output cannot fall below the previewed output minimum.
4. Check a final NEAR block, account collateral, token storage and maximum
   prepaid gas. Only absent wNEAR registrations are added.
5. Signing is currently disabled. The intended flow is to review exact actions
   and personally approve the wallet signature. The single
   transaction targets `wrap.near`: storage registration if needed, wrapping
   exactly 0.5 NEAR, and an exact `ft_transfer` to the signed deposit account.
6. The backend decodes the returned Borsh transaction, validates every action,
   signer, receiver, gas, deposit, arguments and Ed25519 signature, refreshes
   the budget, then writes the deterministic hash before any server broadcast.
   This does not control a wallet that submits before returning the signature.
7. Reconcile that same hash. Verify FINAL NEAR execution, exact actions and
   wNEAR transfer event, the saved quote identity/signature and relay mapping,
   then the USDC transfer against a pinned Arbitrum RPC at `finalized`.

An Arbitrum transaction may be delivered before the RPC considers it finalized.
The console must wait rather than weaken the finality check. An Intents
SUCCESS label does not by itself prove destination delivery.

## Recovery and limitations

The private journal is `.runtime/mainnet-payment/journal.json`; keep it when
restarting. One journal allows at most one funding transaction. A signature
interruption is retained as `AWAITING_SIGNATURE`; an ambiguous broadcast is
retained with its deterministic hash. Inspect and reconcile existing records;
never delete the journal to bypass this guard or repeat a payment.

`REFUNDED` and `FAILED` are relay observations, not independently verified
refunds; refund-chain verification remains to be implemented. A cancellation
before any signed bytes requires an operator review; there is intentionally no
automatic reset or second deposit button.

Cross-chain linkage relies on the official signed quote plus the relay's
transaction mapping and independent RPC observations. It is not a trustless
bridge light-client proof. Historical testnet task funds, model budgets and
Phala resources are separate. This implementation sends no paid model calls
and does not deploy TEE resources.

Official references:

- NEAR Intents: `docs.near-intents.org`, Making a Request / Verify Quote Signatures
- `defuse-protocol/one-click-sdk-typescript`, QuoteRequest / Quote / SwapDetails
- `near/wallet-selector`, `packages/okx-wallet/src/lib/okx-wallet.ts`
- `near/wallet-selector`, `packages/okx-wallet/src/lib/injected-okx-wallet.ts`

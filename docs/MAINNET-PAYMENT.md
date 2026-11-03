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

The local console was initially started and rendered in Chrome. The live quote
revealed additional official defaults, which are now validated explicitly
(public confidentiality, no insurance, zero waiting delay and at most 25 bps
in the default service-fee entry). The first UI preview rejected these defaults
before generating any funding instruction. After the compatibility fix,
restarting the local console was blocked because the approval service could
not complete its review. Live wallet connection, balance preflight, executable
quote issuance and actual payment remain unverified.

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
5. Review exact actions and personally approve the wallet signature. The single
   transaction targets `wrap.near`: storage registration if needed, wrapping
   exactly 0.5 NEAR, and an exact `ft_transfer` to the signed deposit account.
6. The backend decodes the returned Borsh transaction, validates every action,
   signer, receiver, gas, deposit, arguments and Ed25519 signature, refreshes
   the budget, then writes the deterministic hash before broadcasting once.
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

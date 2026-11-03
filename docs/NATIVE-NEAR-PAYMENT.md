# Native NEAR deposit recovery

## Completed mainnet demonstration

The user confirmed the wallet payment on November 3, 2026. Exactly **0.5 NEAR**
was sent and **1.861840 native USDC** arrived on Arbitrum One:

- NEAR source transaction: `Hmd9xudaq3CZz8emgddqAWfQtfgAkNsNx26oEWbJaKJn`
- Arbitrum transaction: `0xa461af7a19f1fced4ed75e1c177250adfc07c87088d21ac2de0126c8864ad014`
- Arbitrum recipient: `0xa2c191561397c584ddad75388b5519e4931ef026`
- USDC contract: `0xaf88d065e77c8cc2239327c5edb3a432268e5831`
- Actual source gas: **0.0071149895375 NEAR**, below the 0.1 NEAR reserve.
- Signed minimum output: **1.842438 USDC**; actual output exceeds that minimum.

The public [evidence file](../evidence/mainnet-native-payment.json) contains the
signed official quote, exact final source outcome, relay mapping and finalized
destination receipt/block observations. The verifier recomputes the result:

```sh
npm run mainnet:verify
# Read both chains again; no signing, funding or broadcast:
npm run mainnet:verify -- --online
```

Offline verification replays recorded RPC observations and the quote signature;
it is not an independently authenticated chain light-client proof. Online mode
rechecks pinned public mainnet RPC endpoints and the original saved order.
No private keys, browser sessions or operator tokens are in the public file.
The initial Arbitrum receipt was successful before it reached `finalized`;
the console preserved `AWAITING_DESTINATION_FINALITY` rather than weakening
that check or sending another deposit.

## Recovery design and preserved history

The original OKX FunctionCall transaction did not pass the exact-action
validator. Its journal and signing lock remain unchanged.

The separate `npm run mainnet:native` console uses OKX's `sendMoney`, which
requests one native NEAR Transfer instead of a batch of FunctionCalls.
The source, Arbitrum One native-USDC recipient, 0.5 NEAR principal, 0.1 NEAR
source-fee reserve and $5 fresh-valuation ceiling are inherited from the
original approved policy.

The official 1Click guide says that origin-chain deposits are sent to the
signed quote's deposit address. Its NEAR guide specifically says managed
1Click integrations handle wrapping. This is different from sending native
NEAR directly to the `intents.near` verifier contract, which is unsupported.

Official references:

- https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
- https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/near-token

The operator inspected the wallet history, source RPC balance and access-key
nonce, original relay status, missing wNEAR storage registration and original
wNEAR deposit balance before preparing this recovery. These checks found no
executed outgoing payment. They do not recover the missing original signed
response or prove an original signed response can never be submitted.

The native console saves its separate `native-journal.json` before handing off
to the wallet, retains the original `journal.json`, and has no transaction
broadcast RPC method. A handoff is allowed once; interruptions require review.
A changed executable output must be explicitly accepted on the same saved
order instead of creating another funding address.

The final financial confirmation belongs to the user in OKX Wallet.
During this run, OKX labeled the native request as an unknown transaction and
did not render a parsed asset change. The operator advised waiting for a
clearer preview; the user independently completed the wallet confirmation.
Post-execution checks verified the exact approved amount and deposit address.
This successful payment does not certify the wallet's transaction-preview UI;
that compatibility issue remains before a general customer rollout.
Recording a wallet hash is not a success claim. Verification requires:

1. Final NEAR execution with the exact signer, one Transfer, exact deposit
   address, exact principal and bounded actual source gas.
2. The official signed quote and relay mapping to that source transaction.
3. A finalized Arbitrum native-USDC Transfer to the approved recipient, matching
   the quoted minimum and relay-delivered amount.

This is a separate demonstration payment. It is not an automatic payout from
the testnet task treasury. No completion or refund is claimed without evidence.

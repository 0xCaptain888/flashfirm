# Live model integration checkpoint

The user authorized a cumulative **CNY 20** model development budget. Gateway access was explicitly supplied by the user. The credential is stored only in `.runtime/provider-secret.json` (0600, parent 0700, ignored by Git). No credential is required by GitHub Actions or Pages.

## Verified discovery

- `GET https://api.apikey.fan/v1/models` returned HTTP 200 with the supplied credential.
- Available IDs: `deepseek-flash`, `deepseek-flash-economy`, `deepseek-v4-pro`.
- Gateway public pricing group metadata describes `deepseek-flash` as the version requested by the user, DeepSeek-V4-1-Flash-1017. This is the gateway's mapping, not independent model-weight verification.
- The public website points at `/api/v1/pricing/groups`; DeepSeek channel multipliers were 0.5 and 0.9 at inspection.
- The public dashboard pricing JavaScript lists Flash peak base rates of CNY 2 input and CNY 8 output per million tokens. Account-specific discounts and the actual invoice have not been queried.

## Cost controls

The provider only calls the fixed HTTPS gateway and fixed model. Redirects are rejected. It limits serialized input to 20,000 bytes, output to 1,600 tokens, total calls to 8, and conservative cumulative reservations to 2,000 fen. A reservation uses input bytes plus 4,096 overhead plus maximum output, priced at **CNY 100 per million** for both directions, without cache discounts. This deliberately exceeds the inspected public rates.

The local reservation is an estimate, **not a provider-side hard billing limit** and not a claim about actual charges. Errors retain their reservation, network calls are not retried automatically, and a filesystem lock prevents concurrent spend races. Stop using this policy if provider pricing changes. A gateway-side account limit would provide an additional independent bound.

`.env.example` documents intended settings only. Current CLI code reads the private `.runtime/provider-policy.json` and secret file. It never enables paid calls from a browser route.

## Real case and trust limits

The first case reviews OpenZeppelin Contracts at commit `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0`: Ownable.sol, Pausable.sol and an explicitly truncated README excerpt. Sources are fetched from fixed raw.githubusercontent.com URLs with byte limits and SHA-256 commitments.

Three real model calls analyze authority, pause integration and scope. A further call critiques their conclusions. Source documents are untrusted data in the prompts. Exact quote validation catches missing and modified citations; it does **not** prove a statement is semantically entailed by the quote. A signed coordinator receipt preserves outputs, usage, model call IDs and the review result.

Initial critique used quote-centered snippets and raised potentially context-induced objections. The initial receipt is retained privately. A follow-up critique receives all fetched excerpts, reusing original worker results, and includes the earlier review history. A changed verdict is not proof that the model became correct.

Coalition selection chooses the least expensive eligible candidate per capability under a local planning budget. These quotes are **local estimates**, not independently submitted vendor bids or model invoices. All selected roles currently use the same DeepSeek model and operator. Independent provider identities, sealed bids, real counterfactual scoring and independent evaluator quorum remain unfinished.

## Run and inspect

```sh
npm run model:probe                     # read-only discovery
npm run live:run                        # paid calls, subject to private policy
npm run live:run -- --resume=TASK_UUID  # reuse saved workers; critique is a new paid call
npm run verify -- .runtime/live-review.json
```

Open `/live.html` on the local server to inspect the recorded live result. Viewing or refreshing it does not call a model. A report that is CHALLENGED must remain challenged; receipt integrity can still pass because it checks faithful records, not approval of their conclusions.

GitHub Pages remains a fixture-only static preview. Real outputs have not been pushed or published. Live NEAR settlement, TEE and cross-chain transfers are not implemented by this adapter.

# Treasury workflow upgrade — 2026-11-02

The wallet page now accepts exact decimal NEAR amounts and guided allocation, challenge, arbitration and recipient fields. Raw parameters remain visible in a read-only advanced disclosure. Conversion uses integers, rejects excess precision, and does not round money.

Loading configuration is read-only. Verified final state shows funded and paid NEAR, reviewer count, challenge status and block height. A Closed treasury disables new transaction previews. A new task needs a new contract; this page does not deploy one.

A pending signing intent prevents another preview/signature in the same tab. Verify the exact transaction hash from wallet history to resolve it. Unknown or failed outcomes are retained for investigation, not automatically retried. This is a tab-level guard, not global deduplication across browsers. A successful final execution clears the intent and refreshes treasury state; a failed refresh does not undo the successful transaction result.

Validation: 60 Node tests including one-yocto round trips, amounts beyond Number precision, overflow and invalid decimal rejection; static Pages build. These UI changes do not establish independent reviewer operation, TEE attestation, cross-chain delivery, or production backend readiness. See DELIVERY-STATUS.md for remaining integration work.

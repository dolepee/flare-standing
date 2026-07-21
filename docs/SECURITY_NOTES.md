# Standing Security Notes

## Hardened candidate

The current source adds three protections after the first Coston2 validation deployment:

1. **Exact token accounting.** Mandate deposits, top-ups, and withdrawals verify exact contract and recipient balance deltas. Fee-on-transfer or otherwise non-conserving behavior reverts atomically instead of recording liabilities the contract did not receive or payouts the recipient did not receive.
2. **Merchant-scoped plan control.** A merchant creates and activates or deactivates only its own plans. The protocol owner cannot mutate merchant plan state.
3. **Explicit cancellation before withdrawal.** An active mandate cannot be withdrawn merely because its next charge is due. The subscriber must cancel first, making the cancellation state and blocked-future-charge guarantee explicit onchain.

Regression tests cover inbound and outbound transfer fees, accounting rollback, unauthorized plan creation and mutation, and withdrawal from a due but active mandate.

## Deployment implication

The historical Coston2 contract at `0xa1ccfe102946be49b7f2224b16402465d46a7c94` predates these changes. Its transaction history remains valid evidence for the initial technical spike, but it is not the hardened release candidate.

Adopting this source requires a new Coston2 deployment from a reviewed commit, followed by a fresh create, open, charge, cancel, blocked-charge, and withdrawal proof set. No proxy or upgrade path exists, so the historical contract cannot be modified in place.

## Remaining boundaries

- The accepted asset must be the verified FXRP/FTestXRP deployment configured at construction.
- The owner can pause new mandate openings, top-ups, and charges, but cannot block cancellation or withdrawal of already-canceled funds.
- The keeper is permissionless and does not receive custody.
- This is internal project hardening, not an independent external audit.

# Standing Security Notes

## Hardened candidate

The current source adds five protections after the first Coston2 validation deployment:

1. **Exact token accounting.** Mandate deposits, top-ups, and withdrawals verify exact contract and recipient balance deltas. Fee-on-transfer or otherwise non-conserving behavior reverts atomically instead of recording liabilities the contract did not receive or payouts the recipient did not receive.
2. **Merchant-scoped plan control.** A merchant creates and activates or deactivates only its own plans. The protocol owner cannot mutate merchant plan state.
3. **Explicit cancellation before withdrawal.** An active mandate cannot be withdrawn merely because its next charge is due. The subscriber must cancel first, making the cancellation state and blocked-future-charge guarantee explicit onchain.
4. **Cross-function reentrancy protection.** Cancellation uses the same guard as token- and oracle-calling entry points, preventing a subscriber contract from changing mandate state during a token or price-adapter callback.
5. **Observable administration.** Pause and ownership changes emit events, and the release source pins Solidity `0.8.28`.

Regression tests cover inbound and outbound transfer fees, accounting rollback, unauthorized plan creation and mutation, and withdrawal from a due but active mandate.

Slither is run against the release candidate. Its remaining reports are reviewed design characteristics: timestamp comparisons implement billing and oracle-freshness boundaries; low-level ERC-20 calls support tokens that return no value; `fromTimestamp == 0` is an internal sentinel; and pre/post balance reads are protected by the entry-point reentrancy guard.

## Deployment implication

The historical Coston2 contract at `0xa1ccfe102946be49b7f2224b16402465d46a7c94` predates these changes. Its transaction history remains valid evidence for the initial technical spike, but it is not the hardened release candidate.

Adopting this source requires a new Coston2 deployment from a reviewed commit, followed by a fresh create, open, charge, cancel, blocked-charge, and withdrawal proof set. No proxy or upgrade path exists, so the historical contract cannot be modified in place.

## Remaining boundaries

- The accepted asset must be the verified FXRP/FTestXRP deployment configured at construction.
- The owner can pause new mandate openings, top-ups, and charges, but cannot block cancellation or withdrawal of already-canceled funds.
- The keeper is permissionless and does not receive custody.
- This is internal project hardening, not an independent external audit.

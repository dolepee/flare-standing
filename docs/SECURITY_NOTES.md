# Standing Security Notes

## Hardened candidate

The current source adds five protections after the first Coston2 validation deployment:

1. **Exact token accounting.** Mandate deposits, top-ups, and withdrawals verify exact contract and recipient balance deltas. Fee-on-transfer or otherwise non-conserving behavior reverts atomically instead of recording liabilities the contract did not receive or payouts the recipient did not receive.
2. **Merchant-scoped plan control.** A merchant creates and activates or deactivates only its own plans. The protocol owner cannot mutate merchant plan state.
3. **Explicit cancellation before withdrawal.** An active mandate cannot be withdrawn merely because its next charge is due. The subscriber must cancel first, making the cancellation state and blocked-future-charge guarantee explicit onchain.
4. **Cross-function reentrancy protection.** Cancellation uses the same guard as token- and oracle-calling entry points, preventing a subscriber contract from changing mandate state during a token or price-adapter callback.
5. **Observable administration.** Pause and ownership changes emit events, and the release source pins Solidity `0.8.28`.

Regression tests cover inbound and outbound transfer fees, false-return and
no-return tokens, accounting rollback, unauthorized plan and mandate mutation,
schedule boundaries, exact withdrawals, ownership transfer, stale and invalid
FTSO results, and withdrawal from a due but active mandate.

Two stateful invariants run 256 sequences and 128,000 calls each:

1. Contract token custody always equals all remaining mandate capacity plus
   merchant and protocol liabilities.
2. A mandate's remaining capacity never exceeds its recorded deposits.

Slither is run against the release candidate. Its remaining reports are reviewed design characteristics: timestamp comparisons implement billing and oracle-freshness boundaries; low-level ERC-20 calls support tokens that return no value; `fromTimestamp == 0` is an internal sentinel; and pre/post balance reads are protected by the entry-point reentrancy guard.

The current Slither run also identifies state writes after token or adapter calls.
Every externally callable path to those calls uses `nonReentrant`; callback and
accounting-rollback tests exercise the boundary. No detector result is treated
as an independent audit finding.

## Deployment implication

The historical Coston2 contract at `0xa1ccfe102946be49b7f2224b16402465d46a7c94` predates these changes. Its transaction history remains valid evidence for the initial technical spike, but it is not the hardened release candidate.

Adopting this source requires a new Coston2 deployment from a reviewed commit, followed by a fresh create, open, charge, cancel, blocked-charge, and withdrawal proof set. No proxy or upgrade path exists, so the historical contract cannot be modified in place.

## Remaining boundaries

- The accepted asset must be the verified FXRP/FTestXRP deployment configured at construction.
- The owner can pause new mandate openings, top-ups, and charges, but cannot block cancellation or withdrawal of already-canceled funds.
- The keeper is permissionless and does not receive custody.
- The shell keeper is read-only by default, validates Coston2 chain ID, simulates
  each due charge, and requires an explicit live mode plus dedicated key. It is
  operational tooling, not a hosted uptime claim.
- The client-side entitlement route is a reference integration, not a secure
  content boundary. A production merchant must authenticate the subscriber
  wallet and enforce entitlement server-side.
- `npm audit` currently reports the React Router RSC action-processing advisory
  against the latest stable `7.18.2`. Standing is a static `BrowserRouter` SPA:
  it has no React Server Components, server actions, or React Router server
  request handler, so the affected path is not reachable here. The dependency
  remains pinned for prompt upgrade when a patched stable release is available.
- This is internal project hardening, not an independent external audit.

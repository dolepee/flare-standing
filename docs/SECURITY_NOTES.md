# Standing Security Notes

## Hardened V2 candidate

The current source adds these protections after the first Coston2 validation deployment:

1. **Exact token accounting.** Mandate deposits, top-ups, and withdrawals verify exact contract and recipient balance deltas. Fee-on-transfer or otherwise non-conserving behavior reverts atomically instead of recording liabilities the contract did not receive or payouts the recipient did not receive.
2. **Merchant-scoped plan control.** A merchant creates and activates or deactivates only its own plans. The protocol owner cannot mutate merchant plan state.
3. **Explicit, drift-safe cancellation before withdrawal.** An active mandate cannot be withdrawn merely because its next charge is due. The subscriber can cancel first or use `cancelAndWithdrawExact`, which cancels and withdraws atomically only when the remaining balance still equals the amount reviewed by the subscriber.
4. **Cross-function reentrancy protection.** Cancellation uses the same guard as token- and oracle-calling entry points, preventing a subscriber contract from changing mandate state during a token or price-adapter callback.
5. **Observable administration.** Pause and ownership changes emit events, and the release source pins Solidity `0.8.28`.
6. **Immediate first value.** `openMandateAndCharge` opens the mandate and
   charges the first period atomically, so a successful subscription does not
   begin in a pending-access state.
7. **User-reviewed FTSO ceiling.** The initial charge is resolved before token
   pull and must not exceed the subscriber's explicit maximum FXRP amount.
8. **Retry-safe underfunding.** A blocked recurring charge no longer advances
   the due timestamp. After a top-up, the same due period can be retried without
   waiting for another cadence boundary.
9. **Recoverable cross-chain execution.** Atomic tooling persists signed FDC
   request and execution transactions before broadcast, resumes delayed direct
   mints from the same proof, and binds completion to the exact XRPL payment,
   Smart Account, mandate, charge, and stored state.
10. **Subscriber-authorized remote exit.** A separate review-first XRPL 0xFE
   operation calls `cancelAndWithdrawExact` to return the reviewed unused FXRP
   to the same Flare Personal Account without giving the executor custody. A
   keeper front-run changes the balance and atomically reverts the exit instead
   of silently returning less. It does not claim to redeem that FXRP back to
   native XRP.
11. **Onchain V2 identity gate.** The contract publishes an exact version and
   capability hash for the atomic open-and-charge and exact cancel-withdraw
   surface. Both XRPL preview builders require that identity before resolving a
   plan or mandate and before returning `READY`; the historical V1 deployment
   fails closed instead of accepting an irreversible authorization for a V2-only
   selector.

Regression tests cover inbound and outbound transfer fees, false-return and
no-return tokens, accounting rollback, unauthorized plan and mandate mutation,
schedule boundaries, exact withdrawals, ownership transfer, stale and invalid
FTSO results, withdrawal from a due but active mandate, keeper/front-run balance
drift, same-host executor-process exclusion, and finalized cross-host
nonce-displacement recovery.

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

Adopting this source requires a new Coston2 deployment from a reviewed commit,
followed by a fresh immediate-open, recurring charge, underfunded retry,
cancellation, and withdrawal proof set. No proxy or upgrade path exists, so
the historical contract cannot be modified in place.

## Remaining boundaries

- The accepted asset must be the verified FXRP/FTestXRP deployment configured at construction.
- The owner can pause new mandate openings, top-ups, and charges, but cannot block cancellation or withdrawal of already-canceled funds.
- The keeper is permissionless and does not receive custody.
- The candidate hosted-keeper workflow is configured for a dedicated
  low-balance key, a 2 C2FLR fail-closed operating floor, exact V2 identity and
  chain checks, and bounded five-mandate paging keyed by GitHub's queued
  workflow-run ordinal. Its 10-second snapshot plus five 30-second mandate
  budgets admit at most 160 seconds of application work; an outer 180-second
  watchdog has a 10-second hard-stop. It performs preflight affordability checks,
  simulation, and exact-mandate receipt-event verification. An uncertain
  post-broadcast result stops the page after hash logging and state reconciliation;
  rotating the first item on later page visits prevents a pathological receipt from
  permanently starving the tail. It is not a live-uptime claim
  until the reviewed workflow runs from the default branch and the dedicated
  key records a receipt. GitHub Actions scheduling remains best-effort and is
  not a precise-cadence guarantee; `queue: max` serializes up to 100 pending actual
  invocations rather than replacing the prior pending run. The shell keeper remains
  read-only by default.
- The client-side entitlement route is a reference integration, not a secure
  content boundary. A production merchant must authenticate the subscriber
  wallet and enforce entitlement server-side.
- The app, atomic tool, and hosted-keeper package audits each report zero known
  vulnerabilities on the 2026-08-10 candidate tree.
- This is internal project hardening, not an independent external audit.

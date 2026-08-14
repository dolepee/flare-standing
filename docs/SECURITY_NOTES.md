# Standing Security Notes

## Hardened V2 release

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

## Deployment status

The current V2 contract is
`0xE8D1ec33dBE87590eB7bE2911451E22F3981B7F7` on Coston2. A fresh controlled
XRPL payment proved the immediate open-and-charge path against this exact
deployment. The public app exposes the paused historical V1 deployment only
for bounded subscriber recovery and receipt verification; V2 is the sole
checkout contract. No proxy or upgrade path exists.

## Remaining boundaries

- The accepted asset must be the verified FXRP/FTestXRP deployment configured at construction.
- The owner can pause new mandate openings, top-ups, and charges, but cannot block cancellation or withdrawal of already-canceled funds.
- The keeper is permissionless and does not receive custody.
- The hosted-keeper workflow is configured for a dedicated
  testnet-only key, a 2 C2FLR fail-closed operating floor, exact V2 identity and
  chain checks, and an in-code plus in-workflow mandate-2 pin with no all-records
  fallback. It uses bounded five-mandate paging keyed by GitHub's queued
  workflow-run ordinal. Its 10-second snapshot plus five 30-second mandate
  budgets admit at most 160 seconds of application work; an outer 180-second
  watchdog has a 10-second hard-stop. It performs preflight affordability checks,
  simulation, and exact-mandate receipt-event verification. An uncertain
  post-broadcast result stops the page after hash logging and state reconciliation;
  rotating the first item on later page visits prevents a pathological receipt from
  permanently starving the tail. A prior default-branch configuration used the
  dedicated key to record the published mandate-1 charge receipt; the current
  mandate-2-only build must not imply a renewal before mandate 2 is due. GitHub
  Actions scheduling remains best-effort and is
  not a precise-cadence guarantee; `queue: max` serializes up to 100 pending actual
  invocations rather than replacing the prior pending run. The shell keeper remains
  read-only by default, supports explicit or bounded all-mandate discovery, and
  refuses silent truncation. The
  contract itself remains permissionless, so third parties can call a due mandate
  directly even when Standing's hosted and shell keepers exclude it.
- The client-side entitlement route is a reference integration, not a secure
  content boundary. A production merchant must authenticate the subscriber
  wallet and enforce entitlement server-side.
- The app, atomic tool, and hosted-keeper package audits each report zero known
  vulnerabilities on the 2026-08-11 candidate tree.
- This is internal project hardening, not an independent external audit.

## Known testnet limitations before mainnet

These are explicit release boundaries, not properties hidden behind the V2
compatibility identifier or the deployment reproduction proof:

- USD-priced mandates bound the first charge and total prepaid capacity, but do
  not store a separate subscriber ceiling for each later FTSO-priced charge.
- Plan price, cadence, merchant, and activation state are onchain; rich product
  metadata is a curated client mapping rather than an onchain hash or signed
  merchant manifest.
- The deployed owner and treasury are single testnet EOAs, and ownership transfer
  is one-step. A production release needs multisig custody and two-step transfer.
- Merchant deactivation immediately blocks future charges but does not refund an
  already-paid service period. A delayed keeper can execute at most one charge,
  then schedules the next period from actual execution time; V2 never performs
  catch-up charges. These semantics are covered by transition tests.
- The browser uses the Coston2 explorer's paginated address-log index to discover
  a connected subscriber's complete mandate history, then reads every discovered
  mandate directly from the contract at one pinned block. Browser contract reads
  and the shell keeper use both RPC endpoints currently published by Flare,
  validate chain ID 114, and fail over on transport errors. The index remains an
  availability dependency, and the hosted keeper still needs independent-provider
  disagreement detection before mainnet.
- `createPlan` remains available while mandate fund operations are paused; V2's
  pause semantics stop new mandate exposure, top-ups, and charges rather than
  listing creation.
- Accidental direct token transfers above recorded liabilities cannot be swept.
  Adding recovery requires an explicit liability accumulator and multisig/
  timelocked excess-only withdrawal in a future deployment.
- Constructor-time deployment checks are operational rather than onchain: the
  release script rejects a wrong chain, missing dependency code, wrong token
  decimals, invalid fee, stale-price configuration, or treasury before broadcast.
  CI separately verifies constructor input, runtime bytecode, and explorer source.
- The invariant suite proves global custody and deposit bounds. Unit and edge
  suites additionally cover multiple actors and plans, variable and stale oracle
  prices, pause and deactivation transitions, missed periods, reentrancy, and
  adversarial token behavior. Longer multi-actor stateful campaigns remain V3 work.

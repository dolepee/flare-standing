# Standing

Standing turns one XRPL payment into an immediately charged recurring mandate
on Flare. The same verified Coston2 execution mints FXRP-compatible FTestXRP,
opens the bounded subscription, and delivers the first paid period; later permissionless keeper
charges need neither the subscriber key nor merchant custody. The subscriber
can cancel onchain and recover every unused unit without asking the merchant.

[Live Coston2 app](https://standing.dolepee.com) ·
[Evidence](https://standing.dolepee.com/evidence) ·
[Deployed V2 contract](https://coston2-explorer.flare.network/address/0xE8D1ec33dBE87590eB7bE2911451E22F3981B7F7)

## Why Flare is load-bearing

- **FAssets:** XRPL users can direct-mint XRP into FXRP-compatible FTestXRP on
  Coston2, the asset held by each testnet mandate.
- **FTSO:** merchants can price plans in USD while the Coston2 charge resolves to FTestXRP
  at execution time.
- **Flare smart accounts:** the validated direct-mint path bound an XRPL sender
  to a Flare account before minting.
- **Coston2 settlement:** plan terms, prepaid capacity, charges, cancellation,
  refunds, merchant accruals, and fees are enforced by the deployed contract.

Remove Flare and the asset path, price conversion, and settlement loop all
disappear.

## Try the product

The public app exposes these operating and evidence surfaces:

- `/demo` presents a public UI-gated demonstration brief mapped to an exact
  paid V2 mandate without requiring a wallet, faucet, or transaction. The
  brief is not private content or a cryptographic content commitment.
- `/plans` discovers live merchant plans.
- `/checkout/:planId` opens and charges a bounded prepaid V2 mandate in the
  same Coston2 transaction after the buyer reviews the exact first-charge cap.
- `/mandates` manages top-ups, cancellation, refunds, and due charges.
- `/access/:mandateId` demonstrates an entitlement derived from the latest
  successful charge.
- `/merchant` creates plans and withdraws completed charges.
- `/evidence` links the deployment, lifecycle, FTSO, and direct-mint receipts.

Curated catalog profiles remain controlled Coston2 fixtures. Curated names are
accepted only when the cataloged merchant address matches the plan's onchain
merchant; every other plan, including the external pilot plan, falls back to
neutral onchain labeling.

## Protocol flow

1. A merchant creates a fixed-FXRP or USD-priced plan.
2. A subscriber approves FXRP and opens a mandate with a chosen capacity. The
   V2 path charges the first period in that same transaction, bounded by an
   explicit maximum initial FXRP amount.
3. Any keeper calls `charge` at `nextChargeAt`.
4. A successful charge credits the merchant and protocol fee ledgers. An
   underfunded charge creates no debt and remains due, so a top-up can be
   retried immediately.
5. The subscriber can cancel at any time. Later charges revert, and the unused
   balance becomes withdrawable.

The protocol is non-custodial in the operational sense that no merchant or
operator can withdraw subscriber capacity. Funds are held by the contract until
a valid scheduled charge or subscriber refund.

## Verify in sixty seconds

```bash
git clone https://github.com/dolepee/flare-standing.git
cd flare-standing

forge fmt --check
forge test
forge coverage --report summary

cd app
npm ci
npm run lint
npm test
npm run build
```

The stateful invariant suite exercises 256 runs and 128,000 calls per
invariant. It checks that token custody always equals outstanding mandate
capacity plus merchant and protocol liabilities, and that no mandate's
remaining balance exceeds its recorded deposits.

## Keeper operation

`tools/keeper` is the hosted Coston2 keeper. It verifies chain ID 114,
the exact V2 capability, a 2 C2FLR keeper operating floor, and a strict nonempty
mandate allowlist before scanning. During the judge window, both reviewed code
and workflow pin that set to durable mandate 2; a mutable repository variable
cannot opt historical mandate 1 in. It never falls back to every mandate. It
pages through only those public records using GitHub's queued workflow-run ordinal,
withholds known-underfunded charges, simulates every candidate, and accepts success
only when the receipt contains a `ChargeExecuted` event for the exact mandate.
Each run is capped at five mandates, with a 10-second snapshot, a 30-second budget
per mandate, and a 180-second process watchdog. Ordinary pre-broadcast failures are
isolated; an uncertain post-broadcast result stops that page after logging the hash
and reconciling state. Later visits rotate their first mandate, so one pathological
receipt cannot permanently starve the page tail. GitHub's `queue: max` preserves
actual invocation ordinals while serializing the dedicated signer. Delayed or absent
best-effort schedules postpone coverage but do not fabricate a skipped ordinal.
Oversized local scans fail closed unless the operator provides a non-negative
`KEEPER_SCAN_CURSOR`. The scheduled GitHub Actions
worker uses a dedicated testnet-only Coston2 key and never receives custody. A
historical default-branch workflow configuration recorded the published
permissionless charge for mandate 1. That receipt proves liveness at its exact
block; it does not claim the current mandate-2-only build has charged before its
due date, nor does it establish an
uptime SLA or exact scheduler cadence.

`script/standing-keeper.sh` remains the read-only-by-default local operator
entry point:

Read-only scan, which requires no key:

```bash
KEEPER_MANDATE_IDS=2 script/standing-keeper.sh --once
```

An explicit local live run requires `RUN_LIVE=1`, `KEEPER_MANDATE_IDS=2`, and a
dedicated `KEEPER_PRIVATE_KEY`. The judge-window shell path refuses any other
mandate ID. `--loop` uses a process lock to prevent duplicate local
workers. GitHub Actions scheduling is best-effort; observed runs may be delayed,
so the 10-minute plan is a fast replay fixture rather than a durable availability
claim.

## Current Coston2 V2 deployment

| Component | Address |
|---|---|
| Standing V2 | `0xE8D1ec33dBE87590eB7bE2911451E22F3981B7F7` |
| FTSO adapter | `0xd076bb76F5A0C489163d746C9Afd0A7f91D06Ae8` |
| FTestXRP | `0x0b6A3645c240605887a5532109323A3E12273dc7` |

The reviewed V2 deployment exposes the
`standing.mandates.v2.open-and-charge.cancel-and-withdraw-exact` compatibility
identifier. It is a client fail-closed interface check, not a source-commit or
deployed-bytecode commitment. Source equivalence is checked separately by
`node script/check-deployment-reproducibility.mjs`.
Its controlled validation proves:

- fixed-FXRP and live FTSO-priced charges;
- top-up, cancellation, post-cancel rejection, and exact refund;
- merchant and protocol withdrawals;
- insufficient-capacity blocking;
- an XRPL testnet direct mint that produced 10 FTestXRP on Coston2 in 153 observed
  seconds;
- one 1.2 XRP testnet authorization followed by resumable FDC settlement; the
  resulting Coston2 execution atomically direct-minted FTestXRP, opened Standing
  V2 mandate 1 with exactly 1 FTestXRP of prepaid capacity, and charged its first
  0.1 FTestXRP cycle; and
- a separate permissionless recurring charge from the dedicated testnet-only
  keeper, without the subscriber key or custody.

Every transaction and the exact claim boundary is recorded in
[`docs/VALIDATION_LOG.md`](docs/VALIDATION_LOG.md). This is builder-controlled
testnet evidence.

The V2 cross-chain proof is independently replayable from its
[XRPL payment](https://testnet.xrpl.org/transactions/54E9F5D3CFEAF5236DD6BE5B8624D8AAE69307D02D027E594B6AA023D756C0FD)
and [Coston2 execution](https://coston2-explorer.flare.network/tx/0x119d29cf92a5a41ae504b151bd6ab5e6bc1d86855f58673fe5f3b4e5d158b2c9).
The same successful Coston2 receipt stored mandate 1 for plan 1 with
`1,000,000` atomic FTestXRP deposited, credited `99,000` atomic FTestXRP to the
merchant and `1,000` to the protocol, and left `900,000` atomic FTestXRP as bounded
recurring capacity at receipt block `33,893,083`. This is a point-in-time
receipt snapshot and not the mandate's current balance. It is controlled-builder testnet evidence, not mainnet
usage or external adoption.

The [Standing V2](https://coston2-explorer.flare.network/address/0xe8d1ec33dbe87590eb7be2911451e22f3981b7f7)
and [FTSO adapter](https://coston2-explorer.flare.network/address/0xd076bb76f5a0c489163d746c9afd0a7f91d06ae8)
sources are explorer verified. CI rebuilds V2 with the pinned compiler, recreates
the constructor input, compares it byte-for-byte with the deployment
transaction, and checks both live runtime hashes and verification records.

At the first due boundary, the dedicated testnet-only keeper—not the deployer or
subscriber—submitted the next permissionless
[charge](https://coston2-explorer.flare.network/tx/0x8c3333505617ef62e2b2823cb0c95ce4ee81a6e601e80978b285865f94d5a2a9).
It credited another `99,000` atomic FTestXRP to the merchant, `1,000` to the
protocol, and left `800,000` atomic FTestXRP at receipt block `33,893,456`. This is
a point-in-time receipt snapshot; the public app's live panel is authoritative
for the current balance. The receipt sender is
`0x232C36580360d3E717fc1A583cDd5bEe0fEE7D7D`.

After capturing that recurrence proof, the operator intentionally retired
fast-cadence plan 1 in
[transaction `0xcfd0…73c17`](https://coston2-explorer.flare.network/tx/0xcfd0bafe9ce0c954727171862a0a24966cd50dfc6e15f6a25d93404e0ce73c17)
at block `33,916,812`. The plan is inactive for new mandates and later charges,
while the Smart Account subscriber retains its contract-level cancellation and
exact-withdrawal rights. At that retirement block, mandate 1 remained
uncanceled with `200,000` atomic FTestXRP of recoverable capacity. The immutable
open and keeper receipts above remain the historical recurrence proof.

### Durable judge showcase

A separate long-lived V2 mandate keeps the product result inspectable through
the judging and announcement window without rewriting the fast historical proof.
Plan 2 charges `0.01 FTestXRP` every 14 days. A fresh XRPL Testnet account paid
`0.3 XRP`; its derived Personal Account opened mandate 2 with `0.1 FTestXRP`,
paid the first `0.01 FTestXRP` immediately, and retained `0.09 FTestXRP` of
contract-enforced capacity. Its next charge is scheduled for
`2026-08-25T05:41:47Z`.

- [Plan 2 creation](https://coston2-explorer.flare.network/tx/0xc871264b7208791409a1b77aa8c9609f37aaae33351e481b60bfe40e510a51ac)
- [XRPL authorization](https://testnet.xrpl.org/transactions/670CB8D1C19E562EF8BF73D006672E2AC56FAF0D29560F025FED68DF315B0595)
- [Atomic open and first charge](https://coston2-explorer.flare.network/tx/0x4bef577198ef681b4778ce2f023676ee7678a78432b2928f75271815f5ca9de5)

The merchant/executor, XRPL-derived subscriber, and configured recurring keeper
are three different addresses. The keeper has not charged mandate 2 because its
first renewal is not due until 25 Aug 2026. This is a controlled Coston2 testnet showcase, not
customer adoption, mainnet usage, or production revenue.

The historical V1 deployment at
`0x8a29c741280554028d76666dc75558d98caab855` remains available for recovery
and receipt verification but is paused for new activity. V2 is the only active
checkout contract; V1 remains solely so historical subscribers can cancel and
recover unused balances. Its earlier proof is
preserved in `docs/VALIDATION_LOG.md` and is not presented as the current
checkout contract.

## Controlled external Coston2 pilot

One external merchant, Virtual, and a separate anonymous subscriber completed
a controlled Coston2 lifecycle using their own wallets on historical V1. Virtual created plan 4,
the subscriber prepaid `1 FTestXRP`, the permissionless keeper path executed
one due FTSO-priced charge, both parties withdrew their respective balances,
and a post-cancel charge reverted with `NotActive()`.

- [Plan created](https://coston2-explorer.flare.network/tx/0xdd9362d5794493e94f7ec26c1ff4b40ba4e545bbc707465a31bb8a3c60382924)
- [Mandate opened](https://coston2-explorer.flare.network/tx/0x1a350e64894b74bd0569249cefae30bffbae26b6b97bbdb111eb92c86e7aa891)
- [Scheduled charge](https://coston2-explorer.flare.network/tx/0x0b645b0c6bc4d8e510b84303cb879f2d945c3480358405bba3c9df8f7297aef7): `0.092905 FTestXRP`
- [Subscriber cancellation](https://coston2-explorer.flare.network/tx/0x09bf4c1c0291edb076b003c6a023f1f07671e627bad7a6dbd048efc5ed40732b)
- [Exact unused-capacity refund](https://coston2-explorer.flare.network/tx/0x1766be15d3e344a63cb238de339a7b2ef259932c288aac4b0cbefabfc892052f): `0.907095 FTestXRP`
- [Virtual merchant withdrawal](https://coston2-explorer.flare.network/tx/0xb1f66ae4984b278c3d01dc58c389339fb80c2e3d22d6caf32acd346b34fe5e0c): `0.091976 FTestXRP`

> “Standing made the recurring Coston2 payment lifecycle easy to verify from
> plan creation through merchant withdrawal.” — Virtual

The transaction links prove the addresses and lifecycle. Participant
independence, Virtual attribution, and the quote are participant attestations;
chain state does not establish controller identity. This is a controlled
external testnet pilot, not production adoption, recurring revenue, a mainnet
customer, or a partnership. The subscriber used disclosed direct contract
calls rather than the browser wallet-connect transaction flow, so it is not an
end-to-end browser UX claim.

## Architecture

- `src/StandingMandates.sol`: plan, mandate, charge, cancellation, and ledger
  state machine.
- `src/FtsoPriceAdapter.sol`: USD-micro to FXRP conversion through FTSO.
- `tools/atomic-subscribe/`: review-first XRPL authorization, resumable FDC
  proof execution, delayed-mint recovery, and XRP-authorized cancellation.
- `tools/keeper/`: scheduled, permissionless Coston2 charge worker.
- `script/standing-keeper.sh`: read-only-by-default local keeper.
- `app/`: Vite/React Coston2 application.
- `test/`: regression, adversarial token, boundary, and stateful invariant
  coverage.
- `docs/SECURITY_NOTES.md`: internal hardening notes and residual trust
  boundaries.

## Security boundaries

- Merchant plan control is scoped to the merchant wallet.
- Subscriber cancellation does not depend on the merchant or owner.
- The owner can pause openings, top-ups, and charges, but cannot cancel for a
  subscriber or withdraw subscriber funds.
- Exact pre/post token balances reject fee-on-transfer and non-conserving token
  behavior.
- Cross-function reentrancy protection covers token and oracle callbacks.
- FTSO-priced charges reject future or stale price timestamps.
- The web entitlement is a reference integration. Protected merchant content
  should be enforced server-side after wallet authentication.
- This repository has undergone internal adversarial testing, not an
  independent external audit.

## Local development

```bash
cd app
npm ci
npm run dev
```

Frontend release gates:

```bash
npm run lint
npm test
npm run build
npm run test:browser
```

Solidity release gates:

```bash
forge fmt --check
forge build --sizes
forge test
forge coverage --report summary
```

## License

MIT. See [`LICENSE`](LICENSE).

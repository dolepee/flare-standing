# Standing

Standing turns one XRPL payment into an immediately charged recurring mandate
on Flare. The same verified Coston2 execution mints FXRP, opens the bounded
subscription, and delivers the first paid period; later permissionless keeper
charges need neither the subscriber key nor merchant custody. The subscriber
can cancel onchain and recover every unused unit without asking the merchant.

[Live Coston2 app](https://standing.dolepee.com) ·
[Evidence](https://standing.dolepee.com/evidence) ·
[Deployed V2 contract](https://coston2-explorer.flare.network/address/0xE8D1ec33dBE87590eB7bE2911451E22F3981B7F7)

## Why Flare is load-bearing

- **FAssets:** XRPL users can direct-mint XRP into FXRP, the asset held by each
  mandate.
- **FTSO:** merchants can price plans in USD while the charge resolves to FXRP
  at execution time.
- **Flare smart accounts:** the validated direct-mint path bound an XRPL sender
  to a Flare account before minting.
- **Coston2 settlement:** plan terms, prepaid capacity, charges, cancellation,
  refunds, merchant accruals, and fees are enforced by the deployed contract.

Remove Flare and the asset path, price conversion, and settlement loop all
disappear.

## Try the product

The public app has five operating surfaces plus shareable checkout and access
routes:

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

`tools/keeper` is the candidate hosted Coston2 keeper. It verifies chain ID 114,
the exact V2 capability, and a 2 C2FLR keeper operating floor before scanning.
It pages through public mandate state using GitHub's queued workflow-run ordinal,
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
worker is configured for a dedicated low-balance Coston2 key and never receives
custody. It is not a live-uptime claim until the reviewed workflow runs from the
default branch and that key records a charge receipt.

`script/standing-keeper.sh` remains the read-only-by-default local operator
entry point:

Read-only scan, which requires no key:

```bash
script/standing-keeper.sh --once
```

An explicit local live run requires `RUN_LIVE=1` and a dedicated
`KEEPER_PRIVATE_KEY`. `--loop` uses a process lock to prevent duplicate local
workers. GitHub Actions scheduling is best-effort, so showcase plan cadences
are no shorter than its operating interval.

## Current Coston2 V2 deployment

| Component | Address |
|---|---|
| Standing V2 | `0xE8D1ec33dBE87590eB7bE2911451E22F3981B7F7` |
| FTSO adapter | `0xd076bb76F5A0C489163d746C9Afd0A7f91D06Ae8` |
| FTestXRP | `0x0b6A3645c240605887a5532109323A3E12273dc7` |

The reviewed V2 deployment is commit-bound to the exact
`standing.mandates.v2.open-and-charge.cancel-and-withdraw-exact` capability.
Its controlled validation proves:

- fixed-FXRP and live FTSO-priced charges;
- top-up, cancellation, post-cancel rejection, and exact refund;
- merchant and protocol withdrawals;
- insufficient-capacity blocking;
- an XRPL testnet direct mint that produced 10 FXRP on Coston2 in 153 observed
  seconds;
- one atomic 1.2 XRP testnet payment that direct-minted FXRP, opened Standing
  V2 mandate 1 with exactly 1 FXRP of prepaid capacity, and charged its first
  0.1 FXRP cycle in the same Coston2 transaction; and
- a separate permissionless recurring charge from the dedicated low-balance
  keeper, without the subscriber key or custody.

Every transaction and the exact claim boundary is recorded in
[`docs/VALIDATION_LOG.md`](docs/VALIDATION_LOG.md). This is builder-controlled
testnet evidence.

The V2 atomic proof is independently replayable from its
[XRPL payment](https://testnet.xrpl.org/transactions/54E9F5D3CFEAF5236DD6BE5B8624D8AAE69307D02D027E594B6AA023D756C0FD)
and [Coston2 execution](https://coston2-explorer.flare.network/tx/0x119d29cf92a5a41ae504b151bd6ab5e6bc1d86855f58673fe5f3b4e5d158b2c9).
The same successful Coston2 receipt stored mandate 1 for plan 1 with
`1,000,000` atomic FXRP deposited, credited `99,000` atomic FXRP to the
merchant and `1,000` to the protocol, and left `900,000` atomic FXRP as bounded
recurring capacity. This is controlled-builder testnet evidence, not mainnet
usage or external adoption.

At the first due boundary, the dedicated low-balance keeper—not the deployer or
subscriber—submitted the next permissionless
[charge](https://coston2-explorer.flare.network/tx/0x8c3333505617ef62e2b2823cb0c95ce4ee81a6e601e80978b285865f94d5a2a9).
It credited another `99,000` atomic FXRP to the merchant, `1,000` to the
protocol, and left `800,000` atomic FXRP. The receipt sender is
`0x232C36580360d3E717fc1A583cDd5bEe0fEE7D7D`.

The historical V1 deployment at
`0x8a29c741280554028d76666dc75558d98caab855` remains available for recovery
and receipt verification but is paused for new activity. Its earlier proof is
preserved in `docs/VALIDATION_LOG.md` and is not presented as the current
checkout contract.

## Controlled external Coston2 pilot

One external merchant, Virtual, and a separate anonymous subscriber completed
a controlled Coston2 lifecycle using their own wallets. Virtual created plan 4,
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

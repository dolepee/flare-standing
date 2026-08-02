# Standing

Standing is recurring billing for XRP users on Flare. A subscriber prepays a
bounded FXRP mandate, a permissionless keeper charges it on schedule, and the
subscriber can cancel onchain and recover every unused unit without asking the
merchant.

[Live Coston2 app](https://standing-flare.vercel.app) ·
[Evidence](https://standing-flare.vercel.app/evidence) ·
[Deployed contract](https://coston2-explorer.flare.network/address/0x8a29c741280554028d76666dc75558d98caab855)

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
- `/checkout/:planId` opens a bounded prepaid mandate.
- `/mandates` manages top-ups, cancellation, refunds, and due charges.
- `/access/:mandateId` demonstrates an entitlement derived from the latest
  successful charge.
- `/merchant` creates plans and withdraws completed charges.
- `/evidence` links the deployment, lifecycle, FTSO, and direct-mint receipts.

The two current catalog entries are controlled Coston2 pilot fixtures, not
external merchant adoption. Curated names are accepted only when the cataloged
merchant address matches the plan's onchain merchant; every other plan falls
back to neutral onchain labeling.

## Protocol flow

1. A merchant creates a fixed-FXRP or USD-priced plan.
2. A subscriber approves FXRP and opens a mandate with a chosen capacity.
3. Any keeper calls `charge` at `nextChargeAt`.
4. A successful charge credits the merchant and protocol fee ledgers. An
   underfunded charge is blocked and advances the schedule without creating
   debt.
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

`script/standing-keeper.sh` is the supervised keeper entry point. It verifies
chain ID 114, reads the latest chain timestamp, discovers due active mandates,
and simulates every candidate before any write.

Read-only scan, which requires no key:

```bash
script/standing-keeper.sh --once
```

An explicit live run requires `RUN_LIVE=1` and a dedicated
`KEEPER_PRIVATE_KEY`. A failed transaction is logged and is not retried within
the same scan. `--loop` uses a process lock to prevent duplicate local workers.
No keeper service is installed or activated by this repository.

## Current Coston2 deployment

| Component | Address |
|---|---|
| Standing | `0x8a29c741280554028d76666dc75558d98caab855` |
| FTSO adapter | `0xd076bb76F5A0C489163d746C9Afd0A7f91D06Ae8` |
| FTestXRP | `0x0b6a3645c240605887a5532109323A3E12273dc7` |

The controlled validation proves:

- fixed-FXRP and live FTSO-priced charges;
- top-up, cancellation, post-cancel rejection, and exact refund;
- merchant and protocol withdrawals;
- insufficient-capacity blocking;
- an XRPL testnet direct mint that produced 10 FXRP on Coston2 in 153 observed
  seconds.

Every transaction and the exact claim boundary is recorded in
[`docs/VALIDATION_LOG.md`](docs/VALIDATION_LOG.md). This is builder-controlled
testnet evidence. External merchant and subscriber validation is still open.

## Architecture

- `src/StandingMandates.sol`: plan, mandate, charge, cancellation, and ledger
  state machine.
- `src/FtsoPriceAdapter.sol`: USD-micro to FXRP conversion through FTSO.
- `script/standing-keeper.sh`: read-only-by-default supervised keeper.
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

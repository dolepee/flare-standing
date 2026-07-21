# Standing

Standing is a Flare-native recurring-payment protocol for XRPL users using FXRP:

- **Prepaid mandate model** (subscriber funds capacity upfront in FXRP)
- **USD- and FXRP-priced plans** (USD plans resolve via FTSO)
- Permissionless keeper-triggered `charge`
- Subscriber `cancel` and `withdrawMandate`
- Merchant/protocol payout rails with fixed fee split
- Explicit chain-anchored accounting; no custodian

## Scope and claim boundaries

This is an EVM-side billing layer. XRPL-to-Flare mint path is used for onboarding and funding in production scenarios, but the core billing is non-custodial and contract-controlled after funds are in the mandate.

## Core flow

1. Merchant creates a plan (`createPlan`) with price, period, and active flag.
2. Subscriber opens a mandate (`openMandate`) and deposits FXRP once.
3. Keeper/agent calls `charge` when `nextChargeAt` is reached.
4. The contract applies the protocol fee and credits merchant/protocol balances.
5. Subscriber can `cancel`; future charges are blocked and remaining funds can be withdrawn.

## Contract surface

- Core protocol: `src/StandingMandates.sol`
- FTSO adapter: `src/FtsoPriceAdapter.sol`
- Deploy scripts: `script/DeployFtsoAdapter.s.sol`, `script/DeployStanding.s.sol`, `script/ChargeKeeper.s.sol`
- Tests: `test/Standing.t.sol`

## Local gates

- `forge fmt`
- `forge build`
- `forge test`
- `forge coverage --report lcov`

## Deployment workflow (example)

```bash
cd /path/to/flare-standing

export FLARE_RPC_URL=<flare-rpc-url>
export FTSO_V2_ADDR=<FTSO-v2-feed-contract>
export FXRP_TOKEN_ADDR=<FXRP-or-FTestXRP>
export FTSO_ADAPTER_ADDR=<deployed-ftso-adapter>
export TREASURY_ADDR=<treasury-wallet>
export PRIVATE_KEY=<deployer-key>

forge script script/DeployFtsoAdapter.s.sol:DeployFtsoAdapter \
  --sig "run(address,uint8)" \
  $FTSO_V2_ADDR 6 \
  --rpc-url "$FLARE_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast

forge script script/DeployStanding.s.sol:DeployStanding \
  --sig "run(address,address,address,uint16,uint256)" \
  $FXRP_TOKEN_ADDR \
  $FTSO_ADAPTER_ADDR \
  $TREASURY_ADDR \
  100 \
  300 \
  --rpc-url "$FLARE_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

## Keeper / keeper-like operation

Use `ChargeKeeper` for dry-runs and post-deploy validation:

```bash
forge script script/ChargeKeeper.s.sol:ChargeKeeper \
  --sig "run(address,uint256)" \
  <STANDING_ADDRESS> <MANDATE_ID> \
  --rpc-url "$FLARE_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

Batch mode:

```bash
forge script script/ChargeKeeper.s.sol:ChargeKeeper \
  --sig "runBatch(address,uint256[])" \
  <STANDING_ADDRESS> "[1,2,3]" \
  --rpc-url "$FLARE_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

## Validation log

Track the 48-hour spike and mainnet proof here:

- `docs/VALIDATION_LOG.md`

## Pre-submission hardening

- Add explicit keeper/retry behavior tests around `charge` and stale pricing failures.
- Add a short public deployment log with txids, addresses, and evidence snapshots.
- Cut scope aggressively around anything outside the mandate loop.

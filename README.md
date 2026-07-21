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

1. Merchant creates its own plan (`createPlan`) with price, period, and active flag.
2. Subscriber opens a mandate (`openMandate`) and deposits FXRP once.
3. Keeper/agent calls `charge` when `nextChargeAt` is reached.
4. The contract applies the protocol fee and credits merchant/protocol balances.
5. Subscriber must `cancel`; future charges are blocked and remaining funds can then be withdrawn.

Merchant plan activation is controlled by the plan's merchant, not the protocol owner. Deposits and withdrawals require exact token balance deltas, so fee-on-transfer and otherwise non-conserving token behavior is rejected instead of creating unbacked accounting.

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

## 48-hour Coston2 spike (live)

- Standing: `0x8a29c741280554028d76666dc75558d98caab855`
- FTSO adapter: `0xd076bb76F5A0C489163d746C9Afd0A7f91D06Ae8`
- FTestXRP: `0x0b6a3645c240605887a5532109323A3E12273dc7`
- XRPL direct mint: `10 XRP` reached an XRPL-derived Flare smart account as
  `10 FXRP` through the official tagged direct-mint flow (`153s` observed)
- Exact deployment and lifecycle receipts: `docs/VALIDATION_LOG.md`

The objective is a complete on-chain loop on Coston2:

1. deploy adapter
2. deploy standing protocol
3. create plan
4. open mandate
5. charge once
6. top-up
7. cancel
8. blocked / failed charge attempt on canceled line

Prerequisites:

- funded Coston2 signer
- `PRIVATE_KEY` with funds for deployment and tx gas
- `ACCOUNT_ADDRESS` matching the key
- `FTESTXRP_TOKEN_ADDR` filled with a valid 40-hex-character Coston2 asset address
  (`0x0b6a3645c240605887a5532109323A3E12273dc7`)
- `TREASURY_ADDR` and merchant addresses for test assertions

Execution template:

```bash
# 0) sanity: set these from one source before running
export COSTON2_RPC=https://coston2-api.flare.network/ext/C/rpc
export FTSO_V2_ADDR=0x3d893C53D9e8056135C26C8c638B76C8b60Df726
export FXRP_TOKEN_ADDR=$FTESTXRP_TOKEN_ADDR

# 1) deploy adapter (dry run first)
forge script script/DeployFtsoAdapter.s.sol:DeployFtsoAdapter \
  --sig "run(address,uint8)" $FTSO_V2_ADDR 6 \
  --rpc-url "$COSTON2_RPC" --private-key "$PRIVATE_KEY"

# 2) broadcast once ready
forge script ... --broadcast > /tmp/flare-ftso-rt.json

# 3) deploy standing
forge script script/DeployStanding.s.sol:DeployStanding \
  --sig "run(address,address,address,uint16,uint256)" \
  $FXRP_TOKEN_ADDR <FTSO_ADAPTER_ADDRESS> $TREASURY_ADDR 100 300 \
  --rpc-url "$COSTON2_RPC" --private-key "$PRIVATE_KEY"

# 4) open live hardhat/etherscan/forge interaction script (or manual CLI) for:
#    - createPlan
#    - openMandate
#    - charge (wait/readiness first)
#    - topUp
#    - cancel
#    - charge (expect NotReady / insufficient state on canceled line)
```

Use the checked runner for shared or previously used deployments. It snapshots
`planCount` and `mandateCount`, derives the IDs created by the current run, and
stops if either counter advances unexpectedly. Do not substitute hardcoded IDs
on a shared deployment.

```bash
export COSTON2_RPC=https://coston2-api.flare.network/ext/C/rpc
export FTSO_V2_ADDR=0x3d893C53D9e8056135C26C8c638B76C8b60Df726
export FTESTXRP_TOKEN_ADDR=0x0b6a3645c240605887a5532109323A3E12273dc7
export FTSO_ADAPTER_ADDRESS=0xd076bb76F5A0C489163d746C9Afd0A7f91D06Ae8
export STANDING_ADDRESS=0x8a29c741280554028d76666dc75558d98caab855
export TREASURY_ADDR="$ACCOUNT_ADDRESS"
export TX_GAS_LIMIT=800000

# Estimate only; no state changes.
RUN_LIVE=0 bash script/coston2-live-loop.sh

# Broadcast one complete lifecycle after checking the dry run.
RUN_LIVE=1 bash script/coston2-live-loop.sh
```

The explicit gas limit avoids a Coston2 FTestXRP proxy under-estimation observed
during validation while actual gas usage remains metered normally.

Capture tx hashes, addresses, and final balances into `docs/VALIDATION_LOG.md`.

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

The validation log separates the historical spike from the current hardened
Coston2 deployment and records the XRPL direct-mint evidence. See
`docs/SECURITY_NOTES.md` for the hardening history.

## Pre-submission hardening

- Add explicit keeper/retry behavior tests around `charge` and stale pricing failures.
- Add a short public deployment log with txids, addresses, and evidence snapshots.
- Cut scope aggressively around anything outside the mandate loop.

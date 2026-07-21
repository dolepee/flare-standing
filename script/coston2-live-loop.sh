#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  RUN_LIVE=1 source env file + script with required vars to execute live txs.
  Leave RUN_LIVE unset/0 for dry-run checks only.

Required vars (exported):
  PRIVATE_KEY
  ACCOUNT_ADDRESS
  TREASURY_ADDR
  COSTON2_RPC
  FTSO_V2_ADDR
  FTESTXRP_TOKEN_ADDR

Optional:
  STANDING_ADDRESS
  FTSO_ADAPTER_ADDRESS
  FEE_BPS (default 100)
  MAX_PRICE_AGE (default 300)
  SUBSCRIBER (defaults to ACCOUNT_ADDRESS)
  CHARGE_WAIT_SECONDS (default 50; must exceed the 45-second smoke-plan period)
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

run_mode="${RUN_LIVE:-0}" # 1 => broadcast, 0/default => dry-run
FEE_BPS="${FEE_BPS:-100}"
MAX_PRICE_AGE="${MAX_PRICE_AGE:-300}"
CHARGE_WAIT_SECONDS="${CHARGE_WAIT_SECONDS:-50}"

: "${PRIVATE_KEY:?Set PRIVATE_KEY in environment}"
: "${ACCOUNT_ADDRESS:?Set ACCOUNT_ADDRESS in environment}"
: "${TREASURY_ADDR:?Set TREASURY_ADDR in environment}"
: "${COSTON2_RPC:?Set COSTON2_RPC in environment}"
: "${FTSO_V2_ADDR:?Set FTSO_V2_ADDR in environment}"
: "${FTESTXRP_TOKEN_ADDR:?Set FTESTXRP_TOKEN_ADDR in environment}"

SUBSCRIBER="${SUBSCRIBER:-$ACCOUNT_ADDRESS}"
CAST_EXTRA=(--rpc-url "$COSTON2_RPC" --private-key "$PRIVATE_KEY")

run_cast() {
  local target="$1"
  local sig="$2"
  shift 2
  if [[ "$run_mode" == "1" ]]; then
    cast send "$target" "$sig" "$@" "${CAST_EXTRA[@]}"
  else
    cast estimate "$target" "$sig" "$@" "${CAST_EXTRA[@]}"
  fi
}

# Amounts for the Coston2 smoke loop
PLAN_PRICE=1000000
DEPOSIT_AMOUNT=3000000
TOPUP_AMOUNT=1000000

run_call() {
  cast call "$@" --rpc-url "$COSTON2_RPC"
}

if ! command -v cast >/dev/null 2>&1 || ! command -v forge >/dev/null 2>&1; then
  echo "Required tool missing: cast/forge"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Required tool missing: jq"
  exit 1
fi

echo "[1/6] Runtime pre-checks"
derived_address="$(cast wallet address --private-key "$PRIVATE_KEY")"
if [[ "$derived_address" != "$ACCOUNT_ADDRESS" ]]; then
  echo "PRIVATE_KEY mismatch: derived ${derived_address}, expected ${ACCOUNT_ADDRESS}"
  exit 1
fi

balance_native="$(cast balance "$ACCOUNT_ADDRESS" --rpc-url "$COSTON2_RPC")"
echo "Signer: $derived_address"
echo "Native balance: $balance_native"

token_balance="$(cast call "$FTESTXRP_TOKEN_ADDR" "balanceOf(address)(uint256)" "$ACCOUNT_ADDRESS" --rpc-url "$COSTON2_RPC")"
echo "Token balance (raw): $token_balance"

if [[ "$token_balance" == "0" ]]; then
  echo "WARNING: token balance is 0. You can still run deploy if funded by ETH/FLR only, but not open/charge flows."
fi

ftso_data="$(cast call "$FTSO_V2_ADDR" "getFeedByIdInWei(bytes21)(uint256,uint64)" 0x015852502f55534400000000000000000000000000 --rpc-url "$COSTON2_RPC")"
echo "FTSO XRPL/USD feed: $ftso_data"

if [[ "${RUN_ADAPTER_DEPLOY:-0}" == "1" ]]; then
  if [[ -z "${FTSO_ADAPTER_ADDRESS:-}" ]]; then
    echo "[2/6] Deploying FTSO adapter (dry-run unless RUN_LIVE=1)"
    if [[ "$run_mode" == "1" ]]; then
      FTSO_ADAPTER_RAW="$(mktemp)"
      forge script script/DeployFtsoAdapter.s.sol:DeployFtsoAdapter \
        --sig "run(address,uint8)" "$FTSO_V2_ADDR" 6 \
        --rpc-url "$COSTON2_RPC" --private-key "$PRIVATE_KEY" --broadcast \
        | tee "$FTSO_ADAPTER_RAW"
      echo "Adapter broadcast complete. Read output in: $FTSO_ADAPTER_RAW"
      echo "Set FTSO_ADAPTER_ADDRESS manually from the deploy output."
    else
      forge script script/DeployFtsoAdapter.s.sol:DeployFtsoAdapter \
        --sig "run(address,uint8)" "$FTSO_V2_ADDR" 6 \
        --rpc-url "$COSTON2_RPC" --private-key "$PRIVATE_KEY"
    fi
    echo "Set FTSO_ADAPTER_ADDRESS before continuing."
    exit 0
  fi
fi

: "${FTSO_ADAPTER_ADDRESS:?Set FTSO_ADAPTER_ADDRESS manually unless RUN_ADAPTER_DEPLOY=1 deploys it}"

if [[ "${RUN_STANDING_DEPLOY:-0}" == "1" ]]; then
  if [[ -z "${STANDING_ADDRESS:-}" ]]; then
    echo "[3/6] Deploying Standing contract (dry-run unless RUN_LIVE=1)"
    if [[ "$run_mode" == "1" ]]; then
      STANDING_RAW="$(mktemp)"
      forge script script/DeployStanding.s.sol:DeployStanding \
        --sig "run(address,address,address,uint16,uint256)" \
        "$FTESTXRP_TOKEN_ADDR" "$FTSO_ADAPTER_ADDRESS" "$TREASURY_ADDR" "$FEE_BPS" "$MAX_PRICE_AGE" \
        --rpc-url "$COSTON2_RPC" --private-key "$PRIVATE_KEY" --broadcast \
        | tee "$STANDING_RAW"
      echo "Standing broadcast complete. Read output in: $STANDING_RAW"
      echo "Set STANDING_ADDRESS manually from the deploy output."
    else
      forge script script/DeployStanding.s.sol:DeployStanding \
        --sig "run(address,address,address,uint16,uint256)" \
        "$FTESTXRP_TOKEN_ADDR" "$FTSO_ADAPTER_ADDRESS" "$TREASURY_ADDR" "$FEE_BPS" "$MAX_PRICE_AGE" \
        --rpc-url "$COSTON2_RPC" --private-key "$PRIVATE_KEY"
    fi
    echo "Set STANDING_ADDRESS before continuing."
    exit 0
  fi
fi

: "${STANDING_ADDRESS:?Set STANDING_ADDRESS manually or RUN_STANDING_DEPLOY=1}"

echo "[4/6] Running mandated lifecycle (dry-run unless RUN_LIVE=1)"
echo "approve stand token spend"
run_cast "$FTESTXRP_TOKEN_ADDR" "approve(address,uint256)" "$STANDING_ADDRESS" $((PLAN_PRICE + DEPOSIT_AMOUNT + TOPUP_AMOUNT))

echo "createPlan"
before_plan_count="$(cast call "$STANDING_ADDRESS" "planCount()(uint256)" --rpc-url "$COSTON2_RPC")"
run_cast "$STANDING_ADDRESS" "createPlan(uint256,uint256,uint32,address)" 0 $PLAN_PRICE 45 "$SUBSCRIBER"

if [[ "$run_mode" != "1" ]]; then
  echo "Dry-run preflight complete. The remaining lifecycle is stateful and requires RUN_LIVE=1."
  exit 0
fi

after_plan_count="$(cast call "$STANDING_ADDRESS" "planCount()(uint256)" --rpc-url "$COSTON2_RPC")"
expected_plan_count=$((before_plan_count + 1))
if [[ "$after_plan_count" -ne "$expected_plan_count" ]]; then
  echo "ERROR: planCount advanced from $before_plan_count to $after_plan_count; refusing to select a potentially foreign plan"
  exit 1
fi
PLAN_ID="$expected_plan_count"

echo "plan id in this run: $PLAN_ID (previous count $before_plan_count)"

echo "openMandate"
before_mandate_count="$(cast call "$STANDING_ADDRESS" "mandateCount()(uint256)" --rpc-url "$COSTON2_RPC")"
run_cast "$STANDING_ADDRESS" "openMandate(uint256,uint256)" "$PLAN_ID" $DEPOSIT_AMOUNT
after_mandate_count="$(cast call "$STANDING_ADDRESS" "mandateCount()(uint256)" --rpc-url "$COSTON2_RPC")"
expected_mandate_count=$((before_mandate_count + 1))
if [[ "$after_mandate_count" -ne "$expected_mandate_count" ]]; then
  echo "ERROR: mandateCount advanced from $before_mandate_count to $after_mandate_count; refusing to select a potentially foreign mandate"
  exit 1
fi
MANDATE_ID="$expected_mandate_count"
echo "mandate id in this run: $MANDATE_ID (previous count $before_mandate_count)"

echo "waiting ${CHARGE_WAIT_SECONDS}s for the first charge window"
sleep "$CHARGE_WAIT_SECONDS"

echo "charge (first)"
run_cast "$STANDING_ADDRESS" "charge(uint256)" "$MANDATE_ID"

echo "topUp"
run_cast "$STANDING_ADDRESS" "topUp(uint256,uint256)" "$MANDATE_ID" $TOPUP_AMOUNT
echo "cancel"
run_cast "$STANDING_ADDRESS" "cancel(uint256)" "$MANDATE_ID"
echo "charge after cancel (expected NotActive revert)"
set +e
canceled_charge_output="$(cast call "$STANDING_ADDRESS" "charge(uint256)" "$MANDATE_ID" --from "$ACCOUNT_ADDRESS" --rpc-url "$COSTON2_RPC" 2>&1)"
canceled_charge_status=$?
set -e
if [[ "$canceled_charge_status" -eq 0 ]]; then
  echo "ERROR: canceled mandate unexpectedly accepted a charge"
  exit 1
fi
echo "canceled charge rejected: ${canceled_charge_output##*$'\n'}"

echo "[5/6] Summary"
open_state="$(cast call "$STANDING_ADDRESS" "mandate(uint256)(uint256,address,uint256,uint256,uint256,uint256,bool)" "$MANDATE_ID" --rpc-url "$COSTON2_RPC" --json)"
mandate_plan_id="$(echo "$open_state" | jq -r '.[0]')"
mandate_subscriber="$(echo "$open_state" | jq -r '.[1]')"
mandate_deposited="$(echo "$open_state" | jq -r '.[2]')"
mandate_remaining="$(echo "$open_state" | jq -r '.[3]')"
mandate_next_charge="$(echo "$open_state" | jq -r '.[4]')"
mandate_last_charge="$(echo "$open_state" | jq -r '.[5]')"
mandate_canceled="$(echo "$open_state" | jq -r '.[6]')"
echo "mandate id $MANDATE_ID state:"
echo "  planId: $mandate_plan_id"
echo "  subscriber: $mandate_subscriber"
echo "  deposited: $mandate_deposited"
echo "  remaining: $mandate_remaining"
echo "  nextChargeAt: $mandate_next_charge"
echo "  lastChargeAt: $mandate_last_charge"
echo "  canceled: $mandate_canceled"

echo "[6/6] Done"

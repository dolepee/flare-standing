#!/usr/bin/env bash
set -euo pipefail

STANDING_ADDRESS="${STANDING_ADDRESS:-0x8a29c741280554028d76666dc75558d98caab855}"
COSTON2_RPC="${COSTON2_RPC:-https://coston2-api.flare.network/ext/C/rpc}"
RUN_LIVE="${RUN_LIVE:-0}"
KEEPER_INTERVAL_SECONDS="${KEEPER_INTERVAL_SECONDS:-20}"
KEEPER_GAS_LIMIT="${KEEPER_GAS_LIMIT:-800000}"
KEEPER_LOG_PATH="${KEEPER_LOG_PATH:-.standing/keeper.jsonl}"
mode="${1:---once}"

usage() {
  cat <<'EOF'
Usage:
  script/standing-keeper.sh --once   Scan all mandates once (default).
  script/standing-keeper.sh --loop   Repeat the scan under one process lock.

The keeper is read-only by default. Set RUN_LIVE=1 and KEEPER_PRIVATE_KEY in
the environment to broadcast due charge attempts. The script never retries a
failed transaction inside a scan.

Optional environment:
  STANDING_ADDRESS
  COSTON2_RPC
  KEEPER_INTERVAL_SECONDS (default 20)
  KEEPER_GAS_LIMIT (default 800000)
  KEEPER_LOG_PATH (default .standing/keeper.jsonl)
EOF
}

if [[ "$mode" == "--help" || "$mode" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "$mode" != "--once" && "$mode" != "--loop" ]]; then
  usage >&2
  exit 2
fi

mkdir -p "$(dirname "$KEEPER_LOG_PATH")"
lock_file="${KEEPER_LOG_PATH}.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$lock_file"
  if ! flock -n 9; then
    echo "Another keeper process holds $lock_file" >&2
    exit 1
  fi
elif command -v lockf >/dev/null 2>&1; then
  exec 9>"$lock_file"
  if ! lockf -s -t 0 9; then
    echo "Another keeper process holds $lock_file" >&2
    exit 1
  fi
else
  echo "Required locking command missing: install flock or lockf" >&2
  exit 1
fi

for command in cast jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command missing: $command" >&2
    exit 1
  fi
done

# Invoke these only through command substitution or an explicit subshell.
# Closing FD 9 there prevents RPC and JSON children from retaining the lock.
run_cast() {
  exec 9>&-
  cast "$@"
}

run_jq() {
  exec 9>&-
  jq "$@"
}

chain_id="$(run_cast chain-id --rpc-url "$COSTON2_RPC")"
if [[ "$chain_id" != "114" ]]; then
  echo "Refusing keeper run on chain $chain_id; expected Coston2 chain 114" >&2
  exit 1
fi

keeper_address="0x0000000000000000000000000000000000000000"
if [[ "$RUN_LIVE" == "1" ]]; then
  : "${KEEPER_PRIVATE_KEY:?Set KEEPER_PRIVATE_KEY only for an explicit live keeper run}"
  keeper_address="$(run_cast wallet address --private-key "$KEEPER_PRIVATE_KEY")"
fi

log_event() {
  local payload="$1"
  printf '%s\n' "$payload" >>"$KEEPER_LOG_PATH"
  printf '%s\n' "$payload"
}

scan_once() {
  local now mandate_count paused mandate_id mandate_json plan_id remaining next_charge canceled
  local plan_json plan_active price_usd_micro price_fxrp expected_charge expected_event adapter_json price_adapter
  local tx_output tx_hash event event_topic executed_topic blocked_topic
  local scan_mode="dry_run"
  if [[ "$RUN_LIVE" == "1" ]]; then
    scan_mode="live"
  fi
  now="$(run_cast block latest --rpc-url "$COSTON2_RPC" --field timestamp)"
  mandate_count="$(run_cast call "$STANDING_ADDRESS" 'mandateCount()(uint256)' --rpc-url "$COSTON2_RPC")"
  paused="$(run_cast call "$STANDING_ADDRESS" 'paused()(bool)' --rpc-url "$COSTON2_RPC")"

  if [[ "$paused" == "true" ]]; then
    log_event "$(run_jq -cn --arg at "$now" '{at:($at|tonumber),event:"scan_skipped",reason:"protocol_paused"}')"
    return
  fi

  for ((mandate_id = 1; mandate_id <= mandate_count; mandate_id++)); do
    mandate_json="$(run_cast call "$STANDING_ADDRESS" 'mandate(uint256)(uint256,address,uint256,uint256,uint256,uint256,bool)' "$mandate_id" --rpc-url "$COSTON2_RPC" --json)"
    plan_id="$(run_jq -r '.[0]' <<<"$mandate_json")"
    remaining="$(run_jq -r '.[3]' <<<"$mandate_json")"
    next_charge="$(run_jq -r '.[4]' <<<"$mandate_json")"
    canceled="$(run_jq -r '.[6]' <<<"$mandate_json")"

    if [[ "$canceled" == "true" || "$next_charge" == "0" || "$next_charge" -gt "$now" ]]; then
      continue
    fi

    plan_json="$(run_cast call "$STANDING_ADDRESS" 'plan(uint256)(address,uint256,uint256,uint32,bool)' "$plan_id" --rpc-url "$COSTON2_RPC" --json)"
    price_usd_micro="$(run_jq -r '.[1]' <<<"$plan_json")"
    price_fxrp="$(run_jq -r '.[2]' <<<"$plan_json")"
    plan_active="$(run_jq -r '.[4]' <<<"$plan_json")"
    if [[ "$plan_active" != "true" ]]; then
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" '{at:($at|tonumber),event:"charge_withheld",mandateId:$mandateId,reason:"plan_inactive"}')"
      continue
    fi

    if ! (run_cast call "$STANDING_ADDRESS" 'charge(uint256)' "$mandate_id" --from "$keeper_address" --rpc-url "$COSTON2_RPC" >/dev/null); then
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" '{at:($at|tonumber),event:"charge_withheld",mandateId:$mandateId,reason:"simulation_failed"}')"
      continue
    fi

    if [[ "$price_usd_micro" == "0" ]]; then
      expected_charge="$price_fxrp"
    else
      price_adapter="$(run_cast call "$STANDING_ADDRESS" 'priceAdapter()(address)' --rpc-url "$COSTON2_RPC")"
      adapter_json="$(run_cast call "$price_adapter" 'getFxrpForUsdMicro(uint256)(uint256,uint256)' "$price_usd_micro" --rpc-url "$COSTON2_RPC" --json)"
      expected_charge="$(run_jq -r '.[0]' <<<"$adapter_json")"
    fi
    if [[ "$expected_charge" == "0" || "$expected_charge" -gt "$remaining" ]]; then
      expected_event="charge_would_block"
    else
      expected_event="charge_would_execute"
    fi

    if [[ "$RUN_LIVE" != "1" ]]; then
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" --arg event "$expected_event" --arg expected "$expected_charge" --arg remaining "$remaining" '{at:($at|tonumber),event:$event,mandateId:$mandateId,expectedAtomic:($expected|tonumber),remainingAtomic:($remaining|tonumber),mode:"dry_run"}')"
      continue
    fi

    if tx_output="$(run_cast send "$STANDING_ADDRESS" 'charge(uint256)' "$mandate_id" --rpc-url "$COSTON2_RPC" --private-key "$KEEPER_PRIVATE_KEY" --gas-limit "$KEEPER_GAS_LIMIT" --json 2>&1)"; then
      tx_hash="$(run_jq -r '.transactionHash' <<<"$tx_output")"
      executed_topic="$(run_cast keccak 'ChargeExecuted(uint256,address,uint256,uint256,uint256)')"
      blocked_topic="$(run_cast keccak 'ChargeBlocked(uint256,uint256,uint256)')"
      event_topic="$(run_jq -r --arg address "$STANDING_ADDRESS" '[.logs[]? | select((.address | ascii_downcase) == ($address | ascii_downcase)) | .topics[0]][0] // empty' <<<"$tx_output")"
      if [[ "$event_topic" == "$executed_topic" ]]; then
        event="charge_executed"
      elif [[ "$event_topic" == "$blocked_topic" ]]; then
        event="charge_blocked"
      else
        event="charge_outcome_unknown"
      fi
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" --arg txHash "$tx_hash" --arg event "$event" '{at:($at|tonumber),event:$event,mandateId:$mandateId,txHash:$txHash}')"
    else
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" '{at:($at|tonumber),event:"charge_failed",mandateId:$mandateId,retry:false}')"
    fi
  done

  log_event "$(run_jq -cn --arg at "$now" --argjson mandateCount "$mandate_count" --arg mode "$scan_mode" '{at:($at|tonumber),event:"scan_complete",mandateCount:$mandateCount,mode:$mode}')"
}

scan_once
while [[ "$mode" == "--loop" ]]; do
  sleep "$KEEPER_INTERVAL_SECONDS" 9>&-
  scan_once
done

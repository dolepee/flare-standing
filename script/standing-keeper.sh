#!/usr/bin/env bash
set -euo pipefail

STANDING_ADDRESS="${STANDING_ADDRESS:-0xE8D1ec33dBE87590eB7bE2911451E22F3981B7F7}"
COSTON2_RPC="${COSTON2_RPC:-https://coston2-api.flare.network/ext/C/rpc}"
COSTON2_FALLBACK_RPC="${COSTON2_FALLBACK_RPC:-https://falling-skilled-uranium.flare-coston2.quiknode.pro/ext/bc/C/rpc}"
RUN_LIVE="${RUN_LIVE:-0}"
KEEPER_INTERVAL_SECONDS="${KEEPER_INTERVAL_SECONDS:-20}"
KEEPER_GAS_LIMIT="${KEEPER_GAS_LIMIT:-800000}"
KEEPER_LOG_PATH="${KEEPER_LOG_PATH:-.standing/keeper.jsonl}"
KEEPER_MANDATE_IDS="${KEEPER_MANDATE_IDS:-}"
KEEPER_MAX_DISCOVERED_MANDATES="${KEEPER_MAX_DISCOVERED_MANDATES:-500}"
mode="${1:---once}"

usage() {
  cat <<'EOF'
Usage:
  script/standing-keeper.sh --once   Scan configured mandates once.
  script/standing-keeper.sh --loop   Repeat the scan under one process lock.

The keeper is read-only by default. Set RUN_LIVE=1 and KEEPER_PRIVATE_KEY in
the environment to broadcast due charge attempts. The script never retries a
failed transaction inside a scan.

Optional environment:
  STANDING_ADDRESS
  COSTON2_RPC
  COSTON2_FALLBACK_RPC
  KEEPER_INTERVAL_SECONDS (default 20)
  KEEPER_GAS_LIMIT (default 800000)
  KEEPER_LOG_PATH (default .standing/keeper.jsonl)
  KEEPER_MANDATE_IDS (comma-separated positive IDs, or "all")
  KEEPER_MAX_DISCOVERED_MANDATES (default 500; refuses silent truncation)
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

if [[ -z "$KEEPER_MANDATE_IDS" ]]; then
  echo "Refusing keeper run: set KEEPER_MANDATE_IDS to comma-separated IDs or all" >&2
  exit 1
fi
if [[ "$KEEPER_MANDATE_IDS" != "all" && ! "$KEEPER_MANDATE_IDS" =~ ^[1-9][0-9]*(,[1-9][0-9]*)*$ ]]; then
  echo "Refusing keeper run: KEEPER_MANDATE_IDS must contain positive comma-separated integers or all" >&2
  exit 1
fi
if [[ ! "$KEEPER_MAX_DISCOVERED_MANDATES" =~ ^[1-9][0-9]*$ ]]; then
  echo "Refusing keeper run: KEEPER_MAX_DISCOVERED_MANDATES must be a positive integer" >&2
  exit 1
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

decimal_gt() {
  local left="$1" right="$2"
  while [[ "${#left}" -gt 1 && "${left:0:1}" == "0" ]]; do left="${left:1}"; done
  while [[ "${#right}" -gt 1 && "${right:0:1}" == "0" ]]; do right="${right:1}"; done
  if [[ "${#left}" -ne "${#right}" ]]; then
    [[ "${#left}" -gt "${#right}" ]]
    return
  fi
  [[ "$left" > "$right" ]]
}

readonly COSTON2_PRIMARY_RPC="$COSTON2_RPC"
readonly COSTON2_SECONDARY_RPC="$COSTON2_FALLBACK_RPC"
VALIDATED_RPCS=()

validate_rpcs() {
  local endpoint chain_id
  for endpoint in "$COSTON2_PRIMARY_RPC" "$COSTON2_SECONDARY_RPC"; do
    if chain_id="$(run_cast chain-id --rpc-url "$endpoint" 2>/dev/null)" && [[ "$chain_id" == "114" ]]; then
      VALIDATED_RPCS+=("$endpoint")
    fi
  done
  [[ "${#VALIDATED_RPCS[@]}" -gt 0 ]]
}

select_rpc() {
  local endpoint chain_id
  # Live selection runs in command substitution. Do not let a stalled probe
  # retain the parent keeper's process lock after the parent is killed.
  exec 9>&-
  for endpoint in "${VALIDATED_RPCS[@]}"; do
    if chain_id="$(run_cast chain-id --rpc-url "$endpoint" 2>/dev/null)" && [[ "$chain_id" == "114" ]]; then
      printf '%s\n' "$endpoint"
      return 0
    fi
  done
  return 1
}

if ! validate_rpcs; then
  echo "Refusing keeper run: neither configured RPC returned Coston2 chain 114" >&2
  exit 1
fi

rpc_cast() {
  local endpoint output
  # rpc_cast is always invoked through command substitution or a subshell. Close
  # the inherited lock so a killed parent cannot leave a slow RPC child holding it.
  exec 9>&-
  for endpoint in "${VALIDATED_RPCS[@]}"; do
    if output="$(run_cast "$@" --rpc-url "$endpoint" 2>/dev/null)"; then
      printf '%s\n' "$output"
      return 0
    fi
  done
  return 1
}

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
  local tx_output tx_hash event event_topic executed_topic blocked_topic scan_description broadcast_rpc
  local -a mandate_ids
  local scan_mode="dry_run"
  if [[ "$RUN_LIVE" == "1" ]]; then
    scan_mode="live"
  fi
  now="$(rpc_cast block latest --field timestamp)"
  mandate_count="$(rpc_cast call "$STANDING_ADDRESS" 'mandateCount()(uint256)')"
  paused="$(rpc_cast call "$STANDING_ADDRESS" 'paused()(bool)')"
  if [[ ! "$now" =~ ^[0-9]+$ || ! "$mandate_count" =~ ^[0-9]+$ ]]; then
    echo "Refusing keeper run: RPC returned malformed numeric state" >&2
    return 1
  fi

  if [[ "$paused" == "true" ]]; then
    log_event "$(run_jq -cn --arg at "$now" '{at:($at|tonumber),event:"scan_skipped",reason:"protocol_paused"}')"
    return
  fi

  if [[ "$KEEPER_MANDATE_IDS" == "all" ]]; then
    if decimal_gt "$mandate_count" "$KEEPER_MAX_DISCOVERED_MANDATES"; then
      echo "Refusing keeper run: $mandate_count mandates exceed discovery limit $KEEPER_MAX_DISCOVERED_MANDATES" >&2
      return 1
    fi
    mandate_ids=()
    for ((mandate_id = 1; mandate_id <= mandate_count; mandate_id++)); do
      mandate_ids+=("$mandate_id")
    done
    scan_description="all"
  else
    local -a configured_mandate_ids
    local configured_id seen_ids=","
    IFS=',' read -r -a configured_mandate_ids <<<"$KEEPER_MANDATE_IDS"
    mandate_ids=()
    for configured_id in "${configured_mandate_ids[@]}"; do
      if [[ "$seen_ids" == *",$configured_id,"* ]]; then
        echo "Refusing keeper run: duplicate mandate ID $configured_id" >&2
        return 1
      fi
      seen_ids+="$configured_id,"
      mandate_ids+=("$configured_id")
    done
    scan_description="explicit"
  fi

  for mandate_id in "${mandate_ids[@]}"; do
    if decimal_gt "$mandate_id" "$mandate_count"; then
      echo "Refusing keeper run: mandate $mandate_id does not exist (count $mandate_count)" >&2
      return 1
    fi
  done

  for mandate_id in "${mandate_ids[@]}"; do
    mandate_json="$(rpc_cast call "$STANDING_ADDRESS" 'mandate(uint256)(uint256,address,uint256,uint256,uint256,uint256,bool)' "$mandate_id" --json)"
    plan_id="$(run_jq -r '.[0]' <<<"$mandate_json")"
    remaining="$(run_jq -r '.[3]' <<<"$mandate_json")"
    next_charge="$(run_jq -r '.[4]' <<<"$mandate_json")"
    canceled="$(run_jq -r '.[6]' <<<"$mandate_json")"
    if [[ ! "$remaining" =~ ^[0-9]+$ || ! "$next_charge" =~ ^[0-9]+$ ]]; then
      echo "Refusing keeper run: mandate $mandate_id returned malformed numeric state" >&2
      return 1
    fi

    if [[ "$canceled" == "true" || "$next_charge" == "0" ]] || decimal_gt "$next_charge" "$now"; then
      continue
    fi

    plan_json="$(rpc_cast call "$STANDING_ADDRESS" 'plan(uint256)(address,uint256,uint256,uint32,bool)' "$plan_id" --json)"
    price_usd_micro="$(run_jq -r '.[1]' <<<"$plan_json")"
    price_fxrp="$(run_jq -r '.[2]' <<<"$plan_json")"
    plan_active="$(run_jq -r '.[4]' <<<"$plan_json")"
    if [[ ! "$price_usd_micro" =~ ^[0-9]+$ || ! "$price_fxrp" =~ ^[0-9]+$ ]]; then
      echo "Refusing keeper run: plan $plan_id returned malformed numeric state" >&2
      return 1
    fi
    if [[ "$plan_active" != "true" ]]; then
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" '{at:($at|tonumber),event:"charge_withheld",mandateId:$mandateId,reason:"plan_inactive"}')"
      continue
    fi

    if ! (rpc_cast call "$STANDING_ADDRESS" 'charge(uint256)' "$mandate_id" --from "$keeper_address" >/dev/null); then
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" '{at:($at|tonumber),event:"charge_withheld",mandateId:$mandateId,reason:"simulation_failed"}')"
      continue
    fi

    if [[ "$price_usd_micro" == "0" ]]; then
      expected_charge="$price_fxrp"
    else
      price_adapter="$(rpc_cast call "$STANDING_ADDRESS" 'priceAdapter()(address)')"
      adapter_json="$(rpc_cast call "$price_adapter" 'getFxrpForUsdMicro(uint256)(uint256,uint256)' "$price_usd_micro" --json)"
      expected_charge="$(run_jq -r '.[0]' <<<"$adapter_json")"
    fi
    if [[ ! "$expected_charge" =~ ^[0-9]+$ ]]; then
      echo "Refusing keeper run: price adapter returned a malformed charge" >&2
      return 1
    fi
    if [[ "$expected_charge" == "0" ]] || decimal_gt "$expected_charge" "$remaining"; then
      expected_event="charge_would_block"
    else
      expected_event="charge_would_execute"
    fi

    if [[ "$RUN_LIVE" != "1" ]]; then
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" --arg event "$expected_event" --arg expected "$expected_charge" --arg remaining "$remaining" '{at:($at|tonumber),event:$event,mandateId:$mandateId,expectedAtomic:($expected|tonumber),remainingAtomic:($remaining|tonumber),mode:"dry_run"}')"
      continue
    fi

    if ! broadcast_rpc="$(select_rpc)"; then
      log_event "$(run_jq -cn --arg at "$now" --argjson mandateId "$mandate_id" '{at:($at|tonumber),event:"charge_failed",mandateId:$mandateId,retry:false,reason:"no_healthy_rpc"}')"
      continue
    fi
    if tx_output="$(run_cast send "$STANDING_ADDRESS" 'charge(uint256)' "$mandate_id" --rpc-url "$broadcast_rpc" --private-key "$KEEPER_PRIVATE_KEY" --gas-limit "$KEEPER_GAS_LIMIT" --json 2>&1)"; then
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

  log_event "$(run_jq -cn --arg at "$now" --argjson mandateCount "$mandate_count" --argjson scannedCount "${#mandate_ids[@]}" --arg selection "$scan_description" --arg mode "$scan_mode" '{at:($at|tonumber),event:"scan_complete",mandateCount:$mandateCount,scannedCount:$scannedCount,selection:$selection,mode:$mode}')"
}

scan_once
while [[ "$mode" == "--loop" ]]; do
  sleep "$KEEPER_INTERVAL_SECONDS" 9>&-
  scan_once
done

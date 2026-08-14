#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d)"
standing_address="0xE8D1ec33dBE87590eB7bE2911451E22F3981B7F7"
trap 'rm -rf "$temp_dir"' EXIT

ln -s "$root_dir/test/fixtures/fake-cast.sh" "$temp_dir/cast"

run_case() {
  local name="$1"
  local run_live="$2"
  local remaining="$3"
  local receipt_event="$4"
  local expected_event="$5"
  local log_path="$temp_dir/$name.jsonl"

  PATH="$temp_dir:$PATH" \
    STANDING_ADDRESS="$standing_address" \
    RUN_LIVE="$run_live" \
    KEEPER_PRIVATE_KEY="0xkeeper-test-key" \
    KEEPER_LOG_PATH="$log_path" \
    KEEPER_MANDATE_IDS=2 \
    FAKE_REMAINING="$remaining" \
    FAKE_RECEIPT_EVENT="$receipt_event" \
    "$root_dir/script/standing-keeper.sh" --once >/dev/null

  jq -e --arg event "$expected_event" \
    'select(.event == $event and .mandateId == 2)' "$log_path" >/dev/null
}

run_case dry-block 0 500000 blocked charge_would_block
run_case dry-execute 0 2000000 executed charge_would_execute
run_case live-block 1 500000 blocked charge_blocked
run_case live-execute 1 2000000 executed charge_executed

all_log="$temp_dir/all.jsonl"
PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  KEEPER_LOG_PATH="$all_log" \
  KEEPER_MANDATE_IDS=all \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null
jq -e 'select(.event == "scan_complete" and .selection == "all" and .scannedCount == 2)' "$all_log" >/dev/null

failover_log="$temp_dir/failover.jsonl"
PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  COSTON2_RPC="https://primary.invalid/rpc" \
  COSTON2_FALLBACK_RPC="https://fallback.invalid/rpc" \
  FAKE_FAIL_RPC="https://primary.invalid/rpc" \
  KEEPER_LOG_PATH="$failover_log" \
  KEEPER_MANDATE_IDS=2 \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null
jq -e 'select(.event == "scan_complete")' "$failover_log" >/dev/null

wrong_chain_log="$temp_dir/wrong-chain.jsonl"
PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  COSTON2_RPC="https://wrong-chain.invalid/rpc" \
  COSTON2_FALLBACK_RPC="https://coston2.invalid/rpc" \
  FAKE_WRONG_CHAIN_RPC="https://wrong-chain.invalid/rpc" \
  KEEPER_LOG_PATH="$wrong_chain_log" \
  KEEPER_MANDATE_IDS=2 \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null
jq -e 'select(.event == "scan_complete")' "$wrong_chain_log" >/dev/null

if PATH="$temp_dir:$PATH" STANDING_ADDRESS="$standing_address" KEEPER_LOG_PATH="$temp_dir/invalid.jsonl" \
  KEEPER_MANDATE_IDS='2,bad' "$root_dir/script/standing-keeper.sh" --once >/dev/null 2>&1; then
  echo "Keeper accepted malformed mandate IDs" >&2
  exit 1
fi

if PATH="$temp_dir:$PATH" STANDING_ADDRESS="$standing_address" KEEPER_LOG_PATH="$temp_dir/duplicate.jsonl" \
  KEEPER_MANDATE_IDS='2,2' "$root_dir/script/standing-keeper.sh" --once >/dev/null 2>&1; then
  echo "Keeper accepted duplicate mandate IDs" >&2
  exit 1
fi

partial_send_log="$temp_dir/partial-send.log"
if PATH="$temp_dir:$PATH" STANDING_ADDRESS="$standing_address" KEEPER_LOG_PATH="$temp_dir/partial-invalid.jsonl" \
  RUN_LIVE=1 KEEPER_PRIVATE_KEY='0xkeeper-test-key' KEEPER_MANDATE_IDS='2,999' \
  FAKE_REMAINING=500000 FAKE_RECEIPT_EVENT=blocked FAKE_SEND_LOG="$partial_send_log" \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null 2>&1; then
  echo "Keeper accepted a partially invalid mandate selection" >&2
  exit 1
fi
if [[ -s "$partial_send_log" ]]; then
  echo "Keeper broadcast before validating the complete mandate selection" >&2
  exit 1
fi

overflow_send_log="$temp_dir/overflow-send.log"
if PATH="$temp_dir:$PATH" STANDING_ADDRESS="$standing_address" KEEPER_LOG_PATH="$temp_dir/overflow-invalid.jsonl" \
  RUN_LIVE=1 KEEPER_PRIVATE_KEY='0xkeeper-test-key' KEEPER_MANDATE_IDS='2,9223372036854775808' \
  FAKE_REMAINING=500000 FAKE_RECEIPT_EVENT=blocked FAKE_SEND_LOG="$overflow_send_log" \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null 2>&1; then
  echo "Keeper accepted an overflowing mandate ID" >&2
  exit 1
fi
if [[ -s "$overflow_send_log" ]]; then
  echo "Keeper broadcast before rejecting an overflowing mandate ID" >&2
  exit 1
fi

if PATH="$temp_dir:$PATH" STANDING_ADDRESS="$standing_address" KEEPER_LOG_PATH="$temp_dir/overflow.jsonl" \
  KEEPER_MANDATE_IDS=all KEEPER_MAX_DISCOVERED_MANDATES=1 \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null 2>&1; then
  echo "Keeper silently truncated discovered mandates" >&2
  exit 1
fi

stale_log="$temp_dir/stale-lock.jsonl"
printf '2147483647\n' >"${stale_log}.lock"
PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  KEEPER_LOG_PATH="$stale_log" \
  KEEPER_MANDATE_IDS=2 \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null
jq -e 'select(.event == "scan_complete")' "$stale_log" >/dev/null

crash_log="$temp_dir/crash-release.jsonl"
crash_marker="$temp_dir/crash-child-started"
PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  KEEPER_LOG_PATH="$crash_log" \
  KEEPER_MANDATE_IDS=2 \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  FAKE_BLOCK_DELAY=2 \
  FAKE_BLOCK_STARTED="$crash_marker" \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null 2>&1 &
keeper_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -e "$crash_marker" ]] && break
  sleep 0.1
done
if [[ ! -e "$crash_marker" ]]; then
  echo "Delayed keeper child did not start" >&2
  exit 1
fi
kill -9 "$keeper_pid"
wait "$keeper_pid" 2>/dev/null || true

PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  KEEPER_LOG_PATH="$crash_log" \
  KEEPER_MANDATE_IDS=2 \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null
jq -e 'select(.event == "scan_complete")' "$crash_log" >/dev/null

selector_crash_log="$temp_dir/selector-crash-release.jsonl"
selector_marker="$temp_dir/selector-child-started"
selector_count="$temp_dir/selector-chain-id-count"
PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  KEEPER_LOG_PATH="$selector_crash_log" \
  KEEPER_MANDATE_IDS=2 \
  RUN_LIVE=1 \
  KEEPER_PRIVATE_KEY='0xkeeper-test-key' \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  FAKE_CHAIN_ID_COUNT_FILE="$selector_count" \
  FAKE_CHAIN_ID_DELAY=2 \
  FAKE_CHAIN_ID_STARTED="$selector_marker" \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null 2>&1 &
keeper_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -e "$selector_marker" ]] && break
  sleep 0.1
done
if [[ ! -e "$selector_marker" ]]; then
  echo "Delayed RPC selector child did not start" >&2
  exit 1
fi
kill -9 "$keeper_pid"
wait "$keeper_pid" 2>/dev/null || true

PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  KEEPER_LOG_PATH="$selector_crash_log" \
  KEEPER_MANDATE_IDS=2 \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null
jq -e 'select(.event == "scan_complete")' "$selector_crash_log" >/dev/null

printf 'standing keeper outcome and lock tests passed\n'

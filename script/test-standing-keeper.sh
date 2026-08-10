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
    FAKE_REMAINING="$remaining" \
    FAKE_RECEIPT_EVENT="$receipt_event" \
    "$root_dir/script/standing-keeper.sh" --once >/dev/null

  jq -e --arg event "$expected_event" \
    'select(.event == $event and .mandateId == 1)' "$log_path" >/dev/null
}

run_case dry-block 0 500000 blocked charge_would_block
run_case dry-execute 0 2000000 executed charge_would_execute
run_case live-block 1 500000 blocked charge_blocked
run_case live-execute 1 2000000 executed charge_executed

stale_log="$temp_dir/stale-lock.jsonl"
printf '2147483647\n' >"${stale_log}.lock"
PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  KEEPER_LOG_PATH="$stale_log" \
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null
jq -e 'select(.event == "scan_complete")' "$stale_log" >/dev/null

crash_log="$temp_dir/crash-release.jsonl"
crash_marker="$temp_dir/crash-child-started"
PATH="$temp_dir:$PATH" \
  STANDING_ADDRESS="$standing_address" \
  KEEPER_LOG_PATH="$crash_log" \
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
  FAKE_REMAINING=2000000 \
  FAKE_RECEIPT_EVENT=executed \
  "$root_dir/script/standing-keeper.sh" --once >/dev/null
jq -e 'select(.event == "scan_complete")' "$crash_log" >/dev/null

printf 'standing keeper outcome and lock tests passed\n'

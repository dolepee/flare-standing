#!/usr/bin/env bash
set -euo pipefail

standing_address="${STANDING_ADDRESS:?keeper test must provide STANDING_ADDRESS explicitly}"

rpc_url=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--rpc-url" ]]; then
    rpc_url="$argument"
    break
  fi
  previous="$argument"
done

if [[ -n "${FAKE_WRONG_CHAIN_RPC:-}" && "$rpc_url" == "$FAKE_WRONG_CHAIN_RPC" ]]; then
  if [[ "${1:-}" == "chain-id" ]]; then
    printf '1\n'
  else
    printf 'wrong-chain-read\n'
  fi
  exit 0
fi

if [[ "${1:-}" != "chain-id" && -n "${FAKE_FAIL_RPC:-}" ]]; then
  if [[ "$rpc_url" == "$FAKE_FAIL_RPC" ]]; then
    exit 1
  fi
fi

case "${1:-}" in
  chain-id)
    if [[ -n "${FAKE_CHAIN_ID_COUNT_FILE:-}" ]]; then
      chain_id_count=0
      if [[ -f "$FAKE_CHAIN_ID_COUNT_FILE" ]]; then
        chain_id_count="$(cat "$FAKE_CHAIN_ID_COUNT_FILE")"
      fi
      chain_id_count=$((chain_id_count + 1))
      printf '%s\n' "$chain_id_count" >"$FAKE_CHAIN_ID_COUNT_FILE"
      if [[ "$chain_id_count" -ge 3 && "${FAKE_CHAIN_ID_DELAY:-0}" != "0" ]]; then
        if [[ -n "${FAKE_CHAIN_ID_STARTED:-}" ]]; then
          : >"$FAKE_CHAIN_ID_STARTED"
        fi
        sleep "$FAKE_CHAIN_ID_DELAY"
      fi
    fi
    printf '114\n'
    ;;
  block)
    if [[ -n "${FAKE_BLOCK_STARTED:-}" ]]; then
      : >"$FAKE_BLOCK_STARTED"
    fi
    if [[ "${FAKE_BLOCK_DELAY:-0}" != "0" ]]; then
      sleep "$FAKE_BLOCK_DELAY"
    fi
    printf '200\n'
    ;;
  wallet)
    printf '0x0000000000000000000000000000000000000abc\n'
    ;;
  keccak)
    case "${2:-}" in
      'ChargeExecuted(uint256,address,uint256,uint256,uint256)') printf '0xexecuted\n' ;;
      'ChargeBlocked(uint256,uint256,uint256)') printf '0xblocked\n' ;;
      *) exit 1 ;;
    esac
    ;;
  call)
    signature="${3:-}"
    case "$signature" in
      'mandateCount()(uint256)') printf '2\n' ;;
      'paused()(bool)') printf 'false\n' ;;
      'mandate(uint256)(uint256,address,uint256,uint256,uint256,uint256,bool)')
        jq -cn --arg remaining "${FAKE_REMAINING:?}" \
          '["1","0x0000000000000000000000000000000000000def","2000000",$remaining,"100","50",false]'
        ;;
      'plan(uint256)(address,uint256,uint256,uint32,bool)')
        printf '["0x0000000000000000000000000000000000000fed","0","1000000","60",true]\n'
        ;;
      'charge(uint256)') printf '0x\n' ;;
      *) exit 1 ;;
    esac
    ;;
  send)
    if [[ -n "${FAKE_SEND_LOG:-}" ]]; then
      printf '%s\n' "$*" >>"$FAKE_SEND_LOG"
    fi
    case "${FAKE_RECEIPT_EVENT:?}" in
      executed) topic='0xexecuted' ;;
      blocked) topic='0xblocked' ;;
      *) exit 1 ;;
    esac
    jq -cn --arg address "$standing_address" --arg topic "$topic" \
      '{transactionHash:"0xtest",logs:[{address:$address,topics:[$topic]}]}'
    ;;
  *)
    exit 1
    ;;
esac

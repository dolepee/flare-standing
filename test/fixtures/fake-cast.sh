#!/usr/bin/env bash
set -euo pipefail

standing_address="${STANDING_ADDRESS:-0x8a29c741280554028d76666dc75558d98caab855}"

case "${1:-}" in
  chain-id)
    printf '114\n'
    ;;
  block)
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
      'mandateCount()(uint256)') printf '1\n' ;;
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

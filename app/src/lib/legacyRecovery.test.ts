import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import { HISTORICAL_V1_ADDRESS, STANDING_ADDRESS } from '../config'
import type { StandingMandate } from '../contracts'
import { createLegacyRecoveryRequest, HISTORICAL_PERSONAL_ACCOUNT_SUBSCRIBER } from './legacyRecovery'

const subscriber = '0x1111111111111111111111111111111111111111' as Address
const activeMandate: StandingMandate = {
  id: 5n,
  planId: 4n,
  subscriber,
  deposited: 1_000_000n,
  remaining: 902_058n,
  nextChargeAt: 1n,
  lastChargeAt: 1n,
  canceled: false,
}

describe('historical V1 recovery request', () => {
  it('pins both allowed writes to V1 and never the active V2 contract', () => {
    const cancel = createLegacyRecoveryRequest('cancel', activeMandate, subscriber, true)
    const withdraw = createLegacyRecoveryRequest(
      'withdrawMandate',
      { ...activeMandate, canceled: true },
      subscriber,
      true,
    )

    expect(cancel.address).toBe(HISTORICAL_V1_ADDRESS)
    expect(withdraw.address).toBe(HISTORICAL_V1_ADDRESS)
    expect(cancel.address.toLowerCase()).not.toBe(STANDING_ADDRESS.toLowerCase())
    expect(withdraw.address.toLowerCase()).not.toBe(STANDING_ADDRESS.toLowerCase())
    expect(cancel.functionName).toBe('cancel')
    expect(withdraw.functionName).toBe('withdrawMandate')
    expect(cancel.args).toEqual([activeMandate.id])
    expect(withdraw.args).toEqual([activeMandate.id])
  })

  it('rejects non-subscriber, wrong-network, and forbidden writes', () => {
    expect(() => createLegacyRecoveryRequest(
      'cancel',
      activeMandate,
      '0x2222222222222222222222222222222222222222',
      true,
    )).toThrow('original subscriber')
    expect(() => createLegacyRecoveryRequest('cancel', activeMandate, subscriber, false))
      .toThrow('Switch to Coston2')
    expect(() => createLegacyRecoveryRequest('charge', activeMandate, subscriber, true))
      .toThrow('Unsupported historical recovery action')
  })

  it('does not pretend a browser EOA can recover the XRPL-derived Personal Account', () => {
    expect(() => createLegacyRecoveryRequest(
      'cancel',
      { ...activeMandate, subscriber: HISTORICAL_PERSONAL_ACCOUNT_SUBSCRIBER },
      HISTORICAL_PERSONAL_ACCOUNT_SUBSCRIBER,
      true,
    )).toThrow('Personal Account recovery is not available in the browser')
  })

  it('enforces cancel-before-withdraw lifecycle state', () => {
    expect(() => createLegacyRecoveryRequest('cancel', { ...activeMandate, canceled: true }, subscriber, true))
      .toThrow('already canceled')
    expect(() => createLegacyRecoveryRequest('withdrawMandate', activeMandate, subscriber, true))
      .toThrow('Cancel the historical mandate')
    expect(() => createLegacyRecoveryRequest(
      'withdrawMandate',
      { ...activeMandate, canceled: true, remaining: 0n },
      subscriber,
      true,
    )).toThrow('nonzero balance')
  })
})

import { describe, expect, it } from 'vitest'
import type { StandingMandate } from '../contracts'
import { entitlementState } from './entitlement'

const mandate: StandingMandate = {
  id: 1n,
  planId: 2n,
  subscriber: '0x1111111111111111111111111111111111111111',
  deposited: 3_000_000n,
  remaining: 2_000_000n,
  nextChargeAt: 200n,
  lastChargeAt: 100n,
  canceled: false,
}

describe('entitlementState', () => {
  it('unlocks only inside a paid billing window', () => {
    expect(entitlementState(mandate, 60, 150n)).toBe('active')
    expect(entitlementState(mandate, 60, 160n)).toBe('payment_due')
  })

  it('keeps uncharged and canceled mandates locked', () => {
    expect(entitlementState({ ...mandate, lastChargeAt: 0n }, 60, 150n)).toBe('awaiting_first_charge')
    expect(entitlementState({ ...mandate, canceled: true }, 60, 150n)).toBe('canceled')
  })

  it('does not extend access when a blocked charge advances the schedule', () => {
    const afterBlockedCharge = { ...mandate, nextChargeAt: 260n }
    expect(entitlementState(afterBlockedCharge, 60, 170n)).toBe('payment_due')
  })
})

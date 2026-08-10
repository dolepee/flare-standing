import { describe, expect, it } from 'vitest'
import type { StandingPlan } from '../contracts'
import { selectInitialChargeCeiling } from './checkout'

const fixedPlan: StandingPlan = {
  id: 1n,
  merchant: '0x1111111111111111111111111111111111111111',
  priceUsdMicro: 0n,
  priceFxrp: 250_000n,
  periodSeconds: 86_400,
  active: true,
}

const usdPlan: StandingPlan = {
  ...fixedPlan,
  priceUsdMicro: 1_000_000n,
  priceFxrp: 0n,
}

describe('selectInitialChargeCeiling', () => {
  it('uses the exact fixed-FTestXRP price instead of the deposit', () => {
    expect(selectInitialChargeCeiling(fixedPlan, 3_000_000n, 2_000_000n)).toBe(250_000n)
  })

  it('requires a separately reviewed USD-plan ceiling bounded by the deposit', () => {
    expect(() => selectInitialChargeCeiling(usdPlan, 3_000_000n)).toThrow('Review a positive')
    expect(() => selectInitialChargeCeiling(usdPlan, 3_000_000n, 3_000_001n)).toThrow('cannot exceed')
    expect(selectInitialChargeCeiling(usdPlan, 3_000_000n, 150_000n)).toBe(150_000n)
  })
})

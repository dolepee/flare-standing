import { describe, expect, it } from 'vitest'
import type { StandingPlan } from '../contracts'
import { getPlanProfile } from './planCatalog'

const catalogedPlan: StandingPlan = {
  id: 1n,
  merchant: '0x9C7169BAAB226ABCC5C20d1CabebA8BaB9ea99dd',
  priceUsdMicro: 0n,
  priceFxrp: 100_000n,
  periodSeconds: 600,
  active: true,
}

describe('getPlanProfile', () => {
  it('returns curated identity only for the bound onchain merchant', () => {
    expect(getPlanProfile(catalogedPlan).name).toBe('Atomic XRP Access Pass')
    expect(getPlanProfile({ ...catalogedPlan, merchant: '0x1111111111111111111111111111111111111111' }).name)
      .toBe('Onchain recurring plan')
    expect(getPlanProfile({ ...catalogedPlan, merchant: '0x1111111111111111111111111111111111111111' }).merchantName)
      .toBe('Unattributed onchain merchant')
  })
})

import { describe, expect, it } from 'vitest'
import type { StandingPlan } from '../contracts'
import { getPlanProfile } from './planCatalog'

const catalogedPlan: StandingPlan = {
  id: 2n,
  merchant: '0x9C7169BAAB226ABCC5C20d1CabebA8BaB9ea99dd',
  priceUsdMicro: 1_000_000n,
  priceFxrp: 0n,
  periodSeconds: 45,
  active: true,
}

describe('getPlanProfile', () => {
  it('returns curated identity only for the bound onchain merchant', () => {
    expect(getPlanProfile(catalogedPlan).name).toBe('FTSO Creator Pass')
    expect(getPlanProfile({ ...catalogedPlan, merchant: '0x1111111111111111111111111111111111111111' }).name)
      .toBe('Standing recurring plan')
  })
})

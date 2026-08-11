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

  it('binds the durable access pass only to its exact onchain merchant', () => {
    const durablePlan: StandingPlan = {
      id: 2n,
      merchant: '0x4BFed030961344Fe9Ac1B59f31D9f29740aD437a',
      priceUsdMicro: 0n,
      priceFxrp: 10_000n,
      periodSeconds: 1_209_600,
      active: true,
    }
    expect(getPlanProfile(durablePlan).name).toBe('XRP Subscription Launch Brief')
    expect(getPlanProfile({ ...durablePlan, merchant: catalogedPlan.merchant }).name)
      .toBe('Onchain recurring plan')
  })
})

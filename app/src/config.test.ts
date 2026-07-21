import { describe, expect, it } from 'vitest'
import { coston2 } from './config'

describe('Coston2 chain configuration', () => {
  it('binds viem batching to the deployed Multicall3 contract', () => {
    expect(coston2.contracts?.multicall3?.address).toBe(
      '0xcA11bde05977b3631167028862bE2a173976CA11',
    )
  })
})

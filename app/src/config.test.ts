import { describe, expect, it } from 'vitest'
import { isAddress } from 'viem'
import { coston2, FTSO_ADAPTER_ADDRESS, FXRP_ADDRESS, STANDING_ADDRESS } from './config'

describe('Coston2 chain configuration', () => {
  it('binds viem batching to the deployed Multicall3 contract', () => {
    expect(coston2.contracts?.multicall3?.address).toBe(
      '0xcA11bde05977b3631167028862bE2a173976CA11',
    )
  })

  it('uses strictly valid EVM addresses for every configured contract', () => {
    expect(isAddress(STANDING_ADDRESS)).toBe(true)
    expect(isAddress(FXRP_ADDRESS)).toBe(true)
    expect(isAddress(FTSO_ADAPTER_ADDRESS)).toBe(true)
  })
})

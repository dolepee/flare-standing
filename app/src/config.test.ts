import { describe, expect, it } from 'vitest'
import { isAddress } from 'viem'
import { coston2, FTSO_ADAPTER_ADDRESS, FXRP_ADDRESS, HISTORICAL_V1_ADDRESS, STANDING_ADDRESS, V2_CHECKOUT_DEPLOYED } from './config'

describe('Coston2 chain configuration', () => {
  it('binds viem batching to the deployed Multicall3 contract', () => {
    expect(coston2.contracts?.multicall3?.address).toBe(
      '0xcA11bde05977b3631167028862bE2a173976CA11',
    )
  })

  it('uses strictly valid EVM addresses for every configured contract', () => {
    expect(isAddress(STANDING_ADDRESS)).toBe(true)
    expect(isAddress(HISTORICAL_V1_ADDRESS)).toBe(true)
    expect(isAddress(FXRP_ADDRESS)).toBe(true)
    expect(isAddress(FTSO_ADAPTER_ADDRESS)).toBe(true)
  })

  it('binds browser writes to the verified V2 deployment', () => {
    expect(STANDING_ADDRESS).toBe('0xE8D1ec33dBE87590eB7bE2911451E22F3981B7F7')
    expect(V2_CHECKOUT_DEPLOYED).toBe(true)
  })

  it('keeps the retired V1 address distinct for historical recovery', () => {
    expect(HISTORICAL_V1_ADDRESS).toBe('0x8a29c741280554028d76666dc75558d98caab855')
    expect(HISTORICAL_V1_ADDRESS.toLowerCase()).not.toBe(STANDING_ADDRESS.toLowerCase())
  })
})

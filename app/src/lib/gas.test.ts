import { describe, expect, it } from 'vitest'
import { COSTON2_WRITE_GAS_LIMIT, withCoston2GasLimit } from './gas'

describe('Coston2 write gas', () => {
  it('preserves the validated proxy-safe ceiling on wallet requests', () => {
    const request = withCoston2GasLimit({ to: '0x1234', gas: 1n })
    expect(COSTON2_WRITE_GAS_LIMIT).toBe(800_000n)
    expect(request).toEqual({ to: '0x1234', gas: 800_000n })
  })
})

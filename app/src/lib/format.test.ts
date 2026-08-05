import { describe, expect, it } from 'vitest'
import {
  errorMessage,
  formatFxrp,
  formatPeriod,
  formatUsdMicro,
  isSameAddress,
  networkSwitchErrorMessage,
  parseFxrp,
  shortAddress,
} from './format'

describe('format helpers', () => {
  it('round-trips FXRP amounts at six decimals', () => {
    expect(parseFxrp('10.25')).toBe(10_250_000n)
    expect(formatFxrp(10_250_000n)).toBe('10.25')
  })

  it('formats USD micro-units and periods', () => {
    expect(formatUsdMicro(5_000_000n)).toContain('5.00')
    expect(formatPeriod(86_400)).toBe('1d')
  })

  it('compares addresses without case sensitivity', () => {
    expect(isSameAddress('0xAbC', '0xaBc')).toBe(true)
    expect(shortAddress('0x1234567890abcdef')).toBe('0x1234...cdef')
  })

  it('preserves messages from plain wallet-provider errors', () => {
    expect(errorMessage({ code: -32603, message: 'Wallet RPC is unavailable' })).toBe('Wallet RPC is unavailable')
  })

  it('turns network-switch failures into actionable recovery guidance', () => {
    expect(networkSwitchErrorMessage({ code: 4001, message: 'User rejected' })).toBe(
      'Coston2 network request was rejected in the wallet. Approve the switch, then retry.',
    )
    expect(networkSwitchErrorMessage({ code: -32603, message: 'Wallet RPC is unavailable' })).toContain(
      'add or select Coston2 (chain 114)',
    )
  })
})

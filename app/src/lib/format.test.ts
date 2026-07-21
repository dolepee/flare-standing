import { describe, expect, it } from 'vitest'
import { formatFxrp, formatPeriod, formatUsdMicro, isSameAddress, parseFxrp, shortAddress } from './format'

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
})


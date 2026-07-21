import { act, renderHook, waitFor } from '@testing-library/react'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStanding } from './useStanding'

const mocks = vi.hoisted(() => ({ readContract: vi.fn() }))

vi.mock('../lib/chain', () => ({
  publicClient: { readContract: mocks.readContract },
}))

const accountA = '0x1111111111111111111111111111111111111111' as Address
const accountB = '0x2222222222222222222222222222222222222222' as Address
const zeroAddress = '0x0000000000000000000000000000000000000000'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('useStanding', () => {
  beforeEach(() => mocks.readContract.mockReset())

  it('does not commit account balances from a stale refresh', async () => {
    const oldBalance = deferred<bigint>()
    mocks.readContract.mockImplementation((input) => {
      if (!input) return 0n
      const { functionName, args = [] } = input
      if (functionName === 'planCount' || functionName === 'mandateCount' || functionName === 'contractBalance') return 0n
      if (functionName === 'paused') return false
      if (functionName === 'feeBps') return 0
      if (functionName === 'maxPriceAge') return 60n
      if (functionName === 'treasury') return zeroAddress
      if (functionName === 'balanceOf') return args[0] === accountA ? oldBalance.promise : 2_000_000n
      if (functionName === 'allowance') return args[0] === accountA ? 1n : 2n
      if (functionName === 'merchantBalance') return args[0] === accountA ? 10n : 20n
      throw new Error(`Unexpected read: ${functionName}`)
    })

    const { result, rerender } = renderHook(
      ({ account }: { account?: Address }) => useStanding(account),
      { initialProps: { account: accountA } },
    )
    rerender({ account: accountB })

    await waitFor(() => expect(result.current.state.walletBalance).toBe(2_000_000n))
    await act(async () => oldBalance.resolve(1_000_000n))

    expect(result.current.state.walletBalance).toBe(2_000_000n)
    expect(result.current.state.walletAllowance).toBe(2n)
    expect(result.current.state.merchantBalance).toBe(20n)
  })
})

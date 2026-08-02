import { act, renderHook, waitFor } from '@testing-library/react'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStanding } from './useStanding'

const mocks = vi.hoisted(() => ({ getBlock: vi.fn(), readContract: vi.fn() }))

vi.mock('../lib/chain', () => ({
  publicClient: { getBlock: mocks.getBlock, readContract: mocks.readContract },
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
  beforeEach(() => {
    mocks.getBlock.mockReset()
    mocks.getBlock.mockResolvedValue({ timestamp: 200n })
    mocks.readContract.mockReset()
  })

  it('keeps a failed read fail-closed until a retry commits successfully', async () => {
    const retryPlanCount = deferred<bigint>()
    let initialAttempt = true
    mocks.readContract.mockImplementation((input) => {
      if (!input) return 0n
      const { functionName } = input
      if (functionName === 'planCount') {
        if (initialAttempt) return Promise.reject(new Error('RPC unavailable'))
        return retryPlanCount.promise
      }
      if (functionName === 'mandateCount' || functionName === 'contractBalance') return 0n
      if (functionName === 'paused') return false
      if (functionName === 'feeBps') return 0
      if (functionName === 'maxPriceAge') return 60n
      if (functionName === 'treasury') return zeroAddress
      throw new Error(`Unexpected read: ${functionName}`)
    })

    const { result } = renderHook(() => useStanding())
    await waitFor(() => expect(result.current.error).toContain('RPC unavailable'))

    initialAttempt = false
    let retry!: Promise<void>
    act(() => {
      retry = result.current.refresh()
    })
    expect(result.current.error).toContain('RPC unavailable')

    await act(async () => {
      retryPlanCount.resolve(0n)
      await retry
    })
    expect(result.current.error).toBeUndefined()
    expect(result.current.initialized).toBe(true)
    expect(result.current.state.chainTimestamp).toBe(200n)
  })

  it('does not commit account balances from a stale refresh', async () => {
    const oldBalance = deferred<bigint>()
    const newBalance = deferred<bigint>()
    mocks.readContract.mockImplementation((input) => {
      if (!input) return 0n
      const { functionName, args = [] } = input
      if (functionName === 'planCount' || functionName === 'mandateCount' || functionName === 'contractBalance') return 0n
      if (functionName === 'paused') return false
      if (functionName === 'feeBps') return 0
      if (functionName === 'maxPriceAge') return 60n
      if (functionName === 'treasury') return zeroAddress
      if (functionName === 'balanceOf') return args[0] === accountA ? oldBalance.promise : newBalance.promise
      if (functionName === 'allowance') return args[0] === accountA ? 1n : 2n
      if (functionName === 'merchantBalance') return args[0] === accountA ? 10n : 20n
      throw new Error(`Unexpected read: ${functionName}`)
    })

    const { result, rerender } = renderHook(
      ({ account }: { account?: Address }) => useStanding(account),
      { initialProps: { account: accountA } },
    )
    rerender({ account: accountB })
    expect(result.current.state.walletBalance).toBe(0n)
    expect(result.current.state.walletAllowance).toBe(0n)
    expect(result.current.state.merchantBalance).toBe(0n)

    await act(async () => newBalance.resolve(2_000_000n))

    await waitFor(() => expect(result.current.state.walletBalance).toBe(2_000_000n))
    await act(async () => oldBalance.resolve(1_000_000n))

    expect(result.current.state.walletBalance).toBe(2_000_000n)
    expect(result.current.state.walletAllowance).toBe(2n)
    expect(result.current.state.merchantBalance).toBe(20n)
  })
})

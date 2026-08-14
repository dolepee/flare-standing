import { act, renderHook, waitFor } from '@testing-library/react'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStanding } from './useStanding'

const mocks = vi.hoisted(() => ({
  getBlock: vi.fn(),
  getChainId: vi.fn(),
  indexedSubscriberMandateIds: vi.fn(),
  readContract: vi.fn(),
}))

vi.mock('../lib/chain', () => ({
  publicClient: {
    getBlock: mocks.getBlock,
    getChainId: mocks.getChainId,
    readContract: mocks.readContract,
  },
}))
vi.mock('../lib/mandateIndex', () => ({
  indexedSubscriberMandateIds: mocks.indexedSubscriberMandateIds,
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
    mocks.getBlock.mockResolvedValue({ number: 100n, timestamp: 200n })
    mocks.getChainId.mockReset()
    mocks.getChainId.mockResolvedValue(114)
    mocks.indexedSubscriberMandateIds.mockReset()
    mocks.indexedSubscriberMandateIds.mockResolvedValue([])
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
    expect(result.current.state.snapshotBlockNumber).toBe(100n)
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

  it('pins every contract read to one coherent Coston2 block', async () => {
    mocks.readContract.mockImplementation((input) => {
      if (!input) return 0n
      const { functionName } = input
      if (functionName === 'planCount' || functionName === 'mandateCount' || functionName === 'contractBalance') return 0n
      if (functionName === 'paused') return false
      if (functionName === 'feeBps') return 0
      if (functionName === 'maxPriceAge') return 60n
      if (functionName === 'treasury') return zeroAddress
      throw new Error(`Unexpected read: ${functionName}`)
    })

    const { result } = renderHook(() => useStanding())
    await waitFor(() => expect(result.current.initialized).toBe(true))

    expect(result.current.state.snapshotBlockNumber).toBe(100n)
    expect(mocks.readContract).toHaveBeenCalled()
    for (const [input] of mocks.readContract.mock.calls) {
      expect(input.blockNumber).toBe(100n)
    }
  })

  it('reads only a requested checkout plan even when global history is large', async () => {
    mocks.readContract.mockImplementation((input) => {
      if (!input) return 0n
      const { functionName, args = [] } = input
      if (functionName === 'planCount' || functionName === 'mandateCount') return 10_000n
      if (functionName === 'contractBalance') return 0n
      if (functionName === 'paused') return false
      if (functionName === 'feeBps') return 0
      if (functionName === 'maxPriceAge') return 60n
      if (functionName === 'treasury') return zeroAddress
      if (functionName === 'plans' && args[0] === 9_999n) return [accountA, 0n, 10_000n, 86_400, true]
      throw new Error(`Unexpected read: ${functionName} ${args.join(',')}`)
    })

    const { result } = renderHook(() => useStanding(undefined, { planIds: [9_999n], mandateIds: [] }))
    await waitFor(() => expect(result.current.initialized).toBe(true))

    expect(result.current.state.planCount).toBe(10_000n)
    expect(result.current.state.plans.map((plan) => plan.id)).toEqual([9_999n])
    expect(mocks.readContract.mock.calls.filter(([input]) => input.functionName === 'plans')).toHaveLength(1)
    expect(mocks.readContract.mock.calls.filter(([input]) => input.functionName === 'mandates')).toHaveLength(0)
  })

  it('loads only a requested mandate and its referenced plan', async () => {
    mocks.readContract.mockImplementation((input) => {
      if (!input) return 0n
      const { functionName, args = [] } = input
      if (functionName === 'planCount' || functionName === 'mandateCount') return 10_000n
      if (functionName === 'contractBalance') return 0n
      if (functionName === 'paused') return false
      if (functionName === 'feeBps') return 0
      if (functionName === 'maxPriceAge') return 60n
      if (functionName === 'treasury') return zeroAddress
      if (functionName === 'mandates' && args[0] === 8_888n) return [7_777n, accountA, 1n, 1n, 1n, 1n, false]
      if (functionName === 'plans' && args[0] === 7_777n) return [accountA, 0n, 10_000n, 86_400, true]
      throw new Error(`Unexpected read: ${functionName} ${args.join(',')}`)
    })

    const { result } = renderHook(() => useStanding(undefined, { planIds: [], mandateIds: [8_888n] }))
    await waitFor(() => expect(result.current.initialized).toBe(true))

    expect(result.current.state.mandates.map((mandate) => mandate.id)).toEqual([8_888n])
    expect(result.current.state.plans.map((plan) => plan.id)).toEqual([7_777n])
    expect(mocks.readContract.mock.calls.filter(([input]) => input.functionName === 'plans')).toHaveLength(1)
    expect(mocks.readContract.mock.calls.filter(([input]) => input.functionName === 'mandates')).toHaveLength(1)
  })

  it('keeps an older wallet mandate discoverable beyond the recent global window', async () => {
    mocks.getBlock.mockResolvedValue({ number: 33_950_000n, timestamp: 200n })
    mocks.indexedSubscriberMandateIds.mockResolvedValueOnce([1n, 101n])
    mocks.readContract.mockImplementation((input) => {
      if (!input) return 0n
      const { functionName, args = [] } = input
      if (functionName === 'planCount') return 3n
      if (functionName === 'mandateCount') return 100n
      if (functionName === 'contractBalance') return 1n
      if (functionName === 'paused') return false
      if (functionName === 'feeBps') return 100
      if (functionName === 'maxPriceAge') return 300n
      if (functionName === 'treasury') return zeroAddress
      if (functionName === 'mandates') {
        const id = args[0] as bigint
        return [3n, id === 1n ? accountA : accountB, 1n, 1n, 1n, 1n, false]
      }
      if (functionName === 'plans') return [accountA, 0n, 1n, 60, true]
      if (functionName === 'balanceOf' || functionName === 'allowance' || functionName === 'merchantBalance') return 0n
      throw new Error(`Unexpected read: ${functionName}`)
    })

    const { result } = renderHook(() => useStanding(accountA, { planIds: [], catalogLimit: 50 }))
    await waitFor(() => expect(result.current.initialized).toBe(true))

    expect(result.current.state.mandates.some((mandate) => mandate.id === 1n)).toBe(true)
    expect(result.current.state.mandates.some((mandate) => mandate.id === 101n)).toBe(false)
    expect(mocks.readContract.mock.calls.some(([input]) =>
      input.functionName === 'mandates' && input.args?.[0] === 101n,
    )).toBe(false)
    expect(mocks.indexedSubscriberMandateIds).toHaveBeenCalledWith(accountA, 33_950_000n)
  })

  it('fails closed when an RPC reports the wrong chain', async () => {
    mocks.getChainId.mockResolvedValue(14)
    mocks.readContract.mockImplementation((input) => {
      const { functionName } = input
      if (functionName === 'planCount' || functionName === 'mandateCount' || functionName === 'contractBalance') return 0n
      if (functionName === 'paused') return false
      if (functionName === 'feeBps') return 0
      if (functionName === 'maxPriceAge') return 60n
      if (functionName === 'treasury') return zeroAddress
      throw new Error(`Unexpected read: ${functionName}`)
    })

    const { result } = renderHook(() => useStanding())
    await waitFor(() => expect(result.current.error).toContain('expected Coston2 chain 114'))
    expect(result.current.initialized).toBe(false)
  })
})

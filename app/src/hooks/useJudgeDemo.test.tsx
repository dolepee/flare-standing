import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JUDGE_DEMO } from '../lib/judgeDemo'
import { useJudgeDemo } from './useJudgeDemo'

const mocks = vi.hoisted(() => ({ getBlock: vi.fn(), readContract: vi.fn() }))

vi.mock('../lib/chain', () => ({
  publicClient: { getBlock: mocks.getBlock, readContract: mocks.readContract },
}))

function rawPlan(active = true) {
  return [JUDGE_DEMO.merchant, 0n, JUDGE_DEMO.priceFxrp, JUDGE_DEMO.periodSeconds, active] as const
}

function rawMandate(canceled = false) {
  return [
    JUDGE_DEMO.planId,
    JUDGE_DEMO.subscriber,
    JUDGE_DEMO.deposit,
    90_000n,
    JUDGE_DEMO.firstPaidUntil,
    JUDGE_DEMO.openedAt,
    canceled,
  ] as const
}

describe('useJudgeDemo', () => {
  beforeEach(() => {
    mocks.getBlock.mockReset()
    mocks.getBlock.mockResolvedValue({ number: 123n, timestamp: JUDGE_DEMO.openedAt + 1n })
    mocks.readContract.mockReset()
    mocks.readContract.mockImplementation(({ functionName }) => {
      if (functionName === 'plans') return rawPlan()
      if (functionName === 'mandates') return rawMandate()
      throw new Error(`Unexpected broad read: ${functionName}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads only the exact plan and mandate at one coherent block', async () => {
    const { result } = renderHook(() => useJudgeDemo())
    await waitFor(() => expect(result.current.initialized).toBe(true))

    expect(result.current.demo.status).toBe('active')
    expect(mocks.readContract).toHaveBeenCalledTimes(2)
    expect(mocks.readContract.mock.calls.map(([input]) => input.functionName).sort())
      .toEqual(['mandates', 'plans'])
    for (const [input] of mocks.readContract.mock.calls) {
      expect(input.blockNumber).toBe(123n)
    }
  })

  it('locks at the paid boundary without a page reload', async () => {
    vi.useFakeTimers()
    mocks.getBlock.mockResolvedValue({ number: 123n, timestamp: JUDGE_DEMO.firstPaidUntil - 1n })
    const { result } = renderHook(() => useJudgeDemo())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.demo.status).toBe('active')

    act(() => vi.advanceTimersByTime(1_100))
    expect(result.current.demo.status).toBe('payment_due')
  })

  it('fails closed when a refresh cannot verify the live records', async () => {
    const { result } = renderHook(() => useJudgeDemo())
    await waitFor(() => expect(result.current.demo.status).toBe('active'))

    mocks.getBlock.mockRejectedValueOnce(new Error('RPC unavailable'))
    await act(async () => result.current.refresh())

    expect(result.current.error).toContain('RPC unavailable')
  })

  it('relocks after a refreshed cancellation', async () => {
    let canceled = false
    mocks.readContract.mockImplementation(({ functionName }) => {
      if (functionName === 'plans') return rawPlan()
      if (functionName === 'mandates') return rawMandate(canceled)
      throw new Error(`Unexpected broad read: ${functionName}`)
    })
    const { result } = renderHook(() => useJudgeDemo())
    await waitFor(() => expect(result.current.demo.status).toBe('active'))

    canceled = true
    await act(async () => result.current.refresh())
    expect(result.current.demo.status).toBe('canceled')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HISTORICAL_V1_ADDRESS, STANDING_ADDRESS } from '../config'
import { readHistoricalV1Snapshot } from './useHistoricalV1'

const mocks = vi.hoisted(() => ({ getBlock: vi.fn(), readContract: vi.fn() }))

vi.mock('../lib/chain', () => ({
  publicClient: { getBlock: mocks.getBlock, readContract: mocks.readContract },
}))

describe('historical V1 reads', () => {
  beforeEach(() => {
    mocks.getBlock.mockReset()
    mocks.getBlock.mockResolvedValue({ number: 123n, timestamp: 456n })
    mocks.readContract.mockReset()
    mocks.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'planCount' || functionName === 'mandateCount') return 1n
      if (functionName === 'plans') {
        return [
          '0x3333333333333333333333333333333333333333',
          0n,
          100_000n,
          600,
          true,
        ] as const
      }
      if (functionName === 'mandates') {
        return [
          1n,
          '0x1111111111111111111111111111111111111111',
          1_000_000n,
          900_000n,
          600n,
          1n,
          false,
        ] as const
      }
      throw new Error(`Unexpected read: ${functionName}`)
    })
  })

  it('pins every plan and mandate read to the retired V1 contract', async () => {
    const snapshot = await readHistoricalV1Snapshot()

    expect(snapshot.planCount).toBe(1n)
    expect(snapshot.mandateCount).toBe(1n)
    expect(snapshot.snapshotBlockNumber).toBe(123n)
    expect(snapshot.plans).toHaveLength(1)
    expect(snapshot.mandates).toHaveLength(1)
    expect(mocks.readContract).toHaveBeenCalledTimes(4)
    for (const [request] of mocks.readContract.mock.calls) {
      expect(request.address).toBe(HISTORICAL_V1_ADDRESS)
      expect(request.address.toLowerCase()).not.toBe(STANDING_ADDRESS.toLowerCase())
      expect(request.blockNumber).toBe(123n)
    }
  })
})

import { useCallback, useEffect, useRef, useState } from 'react'
import { HISTORICAL_V1_ADDRESS } from '../config'
import { historicalV1RecoveryAbi, type StandingMandate, type StandingPlan } from '../contracts'
import { publicClient } from '../lib/chain'
import { errorMessage } from '../lib/format'

type HistoricalV1State = {
  snapshotBlockNumber: bigint
  planCount: bigint
  mandateCount: bigint
  plans: StandingPlan[]
  mandates: StandingMandate[]
}

const emptyState: HistoricalV1State = {
  snapshotBlockNumber: 0n,
  planCount: 0n,
  mandateCount: 0n,
  plans: [],
  mandates: [],
}

export async function readHistoricalV1Snapshot(
  client: Pick<typeof publicClient, 'getBlock' | 'readContract'> = publicClient,
): Promise<HistoricalV1State> {
  const block = await client.getBlock({ blockTag: 'latest' })
  if (block.number === null) throw new Error('Latest Coston2 block has no number')
  const blockNumber = block.number
  const [planCount, mandateCount] = await Promise.all([
    client.readContract({
      address: HISTORICAL_V1_ADDRESS,
      abi: historicalV1RecoveryAbi,
      functionName: 'planCount',
      blockNumber,
    }),
    client.readContract({
      address: HISTORICAL_V1_ADDRESS,
      abi: historicalV1RecoveryAbi,
      functionName: 'mandateCount',
      blockNumber,
    }),
  ])

  const planIds = Array.from({ length: Number(planCount) }, (_, index) => BigInt(index + 1))
  const mandateIds = Array.from({ length: Number(mandateCount) }, (_, index) => BigInt(index + 1))
  const [rawPlans, rawMandates] = await Promise.all([
    Promise.all(planIds.map((id) => client.readContract({
      address: HISTORICAL_V1_ADDRESS,
      abi: historicalV1RecoveryAbi,
      functionName: 'plans',
      args: [id],
      blockNumber,
    }))),
    Promise.all(mandateIds.map((id) => client.readContract({
      address: HISTORICAL_V1_ADDRESS,
      abi: historicalV1RecoveryAbi,
      functionName: 'mandates',
      args: [id],
      blockNumber,
    }))),
  ])

  return {
    snapshotBlockNumber: blockNumber,
    planCount,
    mandateCount,
    plans: rawPlans.map((plan, index) => ({
      id: planIds[index],
      merchant: plan[0],
      priceUsdMicro: plan[1],
      priceFxrp: plan[2],
      periodSeconds: plan[3],
      active: plan[4],
    })),
    mandates: rawMandates.map((mandate, index) => ({
      id: mandateIds[index],
      planId: mandate[0],
      subscriber: mandate[1],
      deposited: mandate[2],
      remaining: mandate[3],
      nextChargeAt: mandate[4],
      lastChargeAt: mandate[5],
      canceled: mandate[6],
    })),
  }
}

export function useHistoricalV1() {
  const [state, setState] = useState(emptyState)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<string>()
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const nextState = await readHistoricalV1Snapshot()
      if (requestId !== requestIdRef.current) return
      setState(nextState)
      setInitialized(true)
      setError(undefined)
    } catch (nextError) {
      if (requestId === requestIdRef.current) setError(errorMessage(nextError))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { state, loading, initialized, error, refresh }
}

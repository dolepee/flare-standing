import { useCallback, useEffect, useRef, useState } from 'react'
import { STANDING_ADDRESS } from '../config'
import { standingAbi, type StandingMandate, type StandingPlan } from '../contracts'
import { publicClient } from '../lib/chain'
import { errorMessage } from '../lib/format'
import { JUDGE_DEMO, resolveJudgeDemo } from '../lib/judgeDemo'

type JudgeDemoSnapshot = {
  snapshotBlockNumber: bigint
  chainTimestamp: bigint
  plan?: StandingPlan
  mandate?: StandingMandate
}

const emptySnapshot: JudgeDemoSnapshot = {
  snapshotBlockNumber: 0n,
  chainTimestamp: 0n,
}

export function useJudgeDemo() {
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const [nowSeconds, setNowSeconds] = useState(0n)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<string>()
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const latestBlock = await publicClient.getBlock({ blockTag: 'latest' })
      if (latestBlock.number === null) throw new Error('Latest Coston2 block has no number')
      const blockNumber = latestBlock.number
      const [rawPlan, rawMandate] = await Promise.all([
        publicClient.readContract({
          address: STANDING_ADDRESS,
          abi: standingAbi,
          functionName: 'plans',
          args: [JUDGE_DEMO.planId],
          blockNumber,
        }),
        publicClient.readContract({
          address: STANDING_ADDRESS,
          abi: standingAbi,
          functionName: 'mandates',
          args: [JUDGE_DEMO.mandateId],
          blockNumber,
        }),
      ])
      if (requestId !== requestIdRef.current) return
      setSnapshot({
        snapshotBlockNumber: blockNumber,
        chainTimestamp: latestBlock.timestamp,
        plan: {
          id: JUDGE_DEMO.planId,
          merchant: rawPlan[0],
          priceUsdMicro: rawPlan[1],
          priceFxrp: rawPlan[2],
          periodSeconds: rawPlan[3],
          active: rawPlan[4],
        },
        mandate: {
          id: JUDGE_DEMO.mandateId,
          planId: rawMandate[0],
          subscriber: rawMandate[1],
          deposited: rawMandate[2],
          remaining: rawMandate[3],
          nextChargeAt: rawMandate[4],
          lastChargeAt: rawMandate[5],
          canceled: rawMandate[6],
        },
      })
      setError(undefined)
      setInitialized(true)
    } catch (nextError) {
      if (requestId === requestIdRef.current) setError(errorMessage(nextError))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    let inFlight: Promise<void> | undefined

    const runRefresh = () => {
      if (inFlight) return inFlight
      inFlight = refresh().finally(() => {
        inFlight = undefined
      })
      return inFlight
    }
    const schedule = () => {
      timer = window.setTimeout(() => {
        const result = document.visibilityState === 'visible' ? runRefresh() : Promise.resolve()
        void result.finally(() => {
          if (!stopped) schedule()
        })
      }, 10_000)
    }
    const sync = () => {
      if (document.visibilityState === 'visible') void runRefresh()
    }

    void runRefresh().finally(() => {
      if (!stopped) schedule()
    })
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      stopped = true
      requestIdRef.current += 1
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [refresh])

  useEffect(() => {
    if (snapshot.chainTimestamp === 0n) return
    const chainAnchor = snapshot.chainTimestamp
    const monotonicAnchor = performance.now()
    const updateClock = () => {
      const elapsedSeconds = BigInt(Math.floor((performance.now() - monotonicAnchor) / 1_000))
      setNowSeconds(chainAnchor + elapsedSeconds)
    }
    updateClock()
    const timer = window.setInterval(updateClock, 1_000)
    return () => window.clearInterval(timer)
  }, [snapshot.chainTimestamp])

  const chainNow = nowSeconds > snapshot.chainTimestamp ? nowSeconds : snapshot.chainTimestamp
  const demo = resolveJudgeDemo(
    snapshot.plan ? [snapshot.plan] : [],
    snapshot.mandate ? [snapshot.mandate] : [],
    chainNow,
  )

  return { snapshot, demo, loading, initialized, error, refresh }
}

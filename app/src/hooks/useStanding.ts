import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { FXRP_ADDRESS, STANDING_ADDRESS } from '../config'
import {
  erc20Abi,
  standingAbi,
  type StandingMandate,
  type StandingPlan,
} from '../contracts'
import { publicClient } from '../lib/chain'
import { errorMessage } from '../lib/format'

type ProtocolState = {
  planCount: bigint
  mandateCount: bigint
  contractBalance: bigint
  paused: boolean
  feeBps: number
  maxPriceAge: bigint
  treasury: Address
  plans: StandingPlan[]
  mandates: StandingMandate[]
  walletBalance: bigint
  walletAllowance: bigint
  merchantBalance: bigint
}

const emptyState: ProtocolState = {
  planCount: 0n,
  mandateCount: 0n,
  contractBalance: 0n,
  paused: false,
  feeBps: 0,
  maxPriceAge: 0n,
  treasury: '0x0000000000000000000000000000000000000000',
  plans: [],
  mandates: [],
  walletBalance: 0n,
  walletAllowance: 0n,
  merchantBalance: 0n,
}

export function useStanding(account?: Address) {
  const [state, setState] = useState(emptyState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const requestIdRef = useRef(0)
  const accountRef = useRef(account)
  accountRef.current = account

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const requestedAccount = account?.toLowerCase()
    const isCurrentRequest = () =>
      requestId === requestIdRef.current && requestedAccount === accountRef.current?.toLowerCase()

    setLoading(true)
    setError(undefined)
    try {
      const [planCount, mandateCount, contractBalance, paused, feeBps, maxPriceAge, treasury] =
        await Promise.all([
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'planCount' }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'mandateCount' }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'contractBalance' }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'paused' }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'feeBps' }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'maxPriceAge' }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'treasury' }),
        ])

      const planIds = Array.from({ length: Number(planCount) }, (_, index) => BigInt(index + 1))
      const mandateIds = Array.from({ length: Number(mandateCount) }, (_, index) => BigInt(index + 1))

      const [rawPlans, rawMandates, walletBalance, walletAllowance, merchantBalance] =
        await Promise.all([
          Promise.all(
            planIds.map((id) =>
              publicClient.readContract({
                address: STANDING_ADDRESS,
                abi: standingAbi,
                functionName: 'plans',
                args: [id],
              }),
            ),
          ),
          Promise.all(
            mandateIds.map((id) =>
              publicClient.readContract({
                address: STANDING_ADDRESS,
                abi: standingAbi,
                functionName: 'mandates',
                args: [id],
              }),
            ),
          ),
          account
            ? publicClient.readContract({ address: FXRP_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
            : Promise.resolve(0n),
          account
            ? publicClient.readContract({
                address: FXRP_ADDRESS,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [account, STANDING_ADDRESS],
              })
            : Promise.resolve(0n),
          account
            ? publicClient.readContract({
                address: STANDING_ADDRESS,
                abi: standingAbi,
                functionName: 'merchantBalance',
                args: [account],
              })
            : Promise.resolve(0n),
        ])

      const plans = rawPlans.map((plan, index) => ({
        id: planIds[index],
        merchant: plan[0],
        priceUsdMicro: plan[1],
        priceFxrp: plan[2],
        periodSeconds: plan[3],
        active: plan[4],
      }))
      const mandates = rawMandates.map((mandate, index) => ({
        id: mandateIds[index],
        planId: mandate[0],
        subscriber: mandate[1],
        deposited: mandate[2],
        remaining: mandate[3],
        nextChargeAt: mandate[4],
        lastChargeAt: mandate[5],
        canceled: mandate[6],
      }))

      if (!isCurrentRequest()) return
      setState({
        planCount,
        mandateCount,
        contractBalance,
        paused,
        feeBps,
        maxPriceAge,
        treasury,
        plans,
        mandates,
        walletBalance,
        walletAllowance,
        merchantBalance,
      })
    } catch (nextError) {
      if (isCurrentRequest()) setError(errorMessage(nextError))
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }, [account])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { state, loading, error, refresh }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { coston2, FXRP_ADDRESS, STANDING_ADDRESS } from '../config'
import {
  erc20Abi,
  standingAbi,
  type StandingMandate,
  type StandingPlan,
} from '../contracts'
import { publicClient } from '../lib/chain'
import { errorMessage } from '../lib/format'
import { indexedSubscriberMandateIds } from '../lib/mandateIndex'

type ProtocolState = {
  snapshotBlockNumber: bigint
  chainTimestamp: bigint
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
  walletAccount?: Address
}

export type StandingReadScope = {
  planIds?: bigint[]
  mandateIds?: bigint[]
  catalogLimit?: number
}

const DEFAULT_CATALOG_LIMIT = 50

function selectedIds(count: bigint, requested: bigint[] | undefined, limit = DEFAULT_CATALOG_LIMIT) {
  if (requested) return [...new Set(requested)].filter((id) => id > 0n && id <= count)
  const boundedLimit = BigInt(Math.max(0, Math.floor(limit)))
  const first = count > boundedLimit ? count - boundedLimit + 1n : 1n
  return count === 0n ? [] : Array.from({ length: Number(count - first + 1n) }, (_, index) => first + BigInt(index))
}

function idsFromKey(key: string) {
  if (key === '*') return undefined
  if (key === '') return []
  return key.split(',').map(BigInt)
}

const emptyState: ProtocolState = {
  snapshotBlockNumber: 0n,
  chainTimestamp: 0n,
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

export function useStanding(account?: Address, scope: StandingReadScope = {}) {
  const planIdsKey = scope.planIds?.join(',') ?? '*'
  const mandateIdsKey = scope.mandateIds?.join(',') ?? '*'
  const requestedPlanIds = useMemo(() => idsFromKey(planIdsKey), [planIdsKey])
  const requestedMandateIds = useMemo(() => idsFromKey(mandateIdsKey), [mandateIdsKey])
  const [state, setState] = useState(emptyState)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
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
    try {
      const latestBlock = await publicClient.getBlock({ blockTag: 'latest' })
      if (latestBlock.number === null) throw new Error('Latest Coston2 block has no number')
      const blockNumber = latestBlock.number
      const [chainId, planCount, mandateCount, contractBalance, paused, feeBps, maxPriceAge, treasury] =
        await Promise.all([
          publicClient.getChainId(),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'planCount', blockNumber }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'mandateCount', blockNumber }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'contractBalance', blockNumber }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'paused', blockNumber }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'feeBps', blockNumber }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'maxPriceAge', blockNumber }),
          publicClient.readContract({ address: STANDING_ADDRESS, abi: standingAbi, functionName: 'treasury', blockNumber }),
        ])
      if (chainId !== coston2.id) throw new Error(`RPC returned chain ${chainId}; expected Coston2 chain ${coston2.id}`)

      const recentMandateIds = selectedIds(mandateCount, requestedMandateIds, scope.catalogLimit)
      const ownedMandateIds = account && requestedMandateIds === undefined
        ? await indexedSubscriberMandateIds(account, blockNumber)
        : []
      const mandateIds = [...new Set([
        ...recentMandateIds,
        ...ownedMandateIds.filter((id) => id > 0n && id <= mandateCount),
      ])]
        .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      const rawMandates = await Promise.all(
        mandateIds.map((id) =>
          publicClient.readContract({
            address: STANDING_ADDRESS,
            abi: standingAbi,
            functionName: 'mandates',
            args: [id],
            blockNumber,
          }),
        ),
      )
      const mandatePlanIds = rawMandates.map((mandate) => mandate[0])
      const planIds = selectedIds(planCount, requestedPlanIds, scope.catalogLimit)
      for (const planId of mandatePlanIds) {
        if (!planIds.includes(planId)) planIds.push(planId)
      }

      const [rawPlans, walletBalance, walletAllowance, merchantBalance] =
        await Promise.all([
          Promise.all(
            planIds.map((id) =>
              publicClient.readContract({
                address: STANDING_ADDRESS,
                abi: standingAbi,
                functionName: 'plans',
                args: [id],
                blockNumber,
              }),
            ),
          ),
          account
            ? publicClient.readContract({ address: FXRP_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account], blockNumber })
            : Promise.resolve(0n),
          account
            ? publicClient.readContract({
                address: FXRP_ADDRESS,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [account, STANDING_ADDRESS],
                blockNumber,
              })
            : Promise.resolve(0n),
          account
            ? publicClient.readContract({
                address: STANDING_ADDRESS,
                abi: standingAbi,
                functionName: 'merchantBalance',
                args: [account],
                blockNumber,
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
      setError(undefined)
      setState({
        snapshotBlockNumber: blockNumber,
        chainTimestamp: latestBlock.timestamp,
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
        walletAccount: account,
      })
      setInitialized(true)
    } catch (nextError) {
      if (isCurrentRequest()) setError(errorMessage(nextError))
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }, [account, requestedMandateIds, requestedPlanIds, scope.catalogLimit])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const walletSnapshotCurrent = account
    ? state.walletAccount?.toLowerCase() === account.toLowerCase()
    : state.walletAccount === undefined
  const currentState = walletSnapshotCurrent
    ? state
    : { ...state, walletBalance: 0n, walletAllowance: 0n, merchantBalance: 0n }

  return { state: currentState, loading, initialized, error, refresh }
}

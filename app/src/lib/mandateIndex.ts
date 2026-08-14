import { pad, type Address, type Hex } from 'viem'
import { COSTON2_EXPLORER, DEPLOY_BLOCK, STANDING_ADDRESS } from '../config'

const MANDATE_OPENED_TOPIC =
  '0x0c21ab881d9fe6e3d35728873ef269e4967cc9a2338df54323578c6bbdce0fd3'
const EXPLORER_RESULT_LIMIT = 1_000
const MAX_INDEX_REQUESTS = 1_024

type ExplorerLog = {
  blockNumber?: Hex
  topics?: Hex[]
}

type ExplorerLogResponse = {
  message?: string
  result?: ExplorerLog[] | string
  status?: string
}

function queryUrl(account: Address, fromBlock: bigint, toBlock: bigint) {
  const subscriberTopic = pad(account, { size: 32 }).toLowerCase()
  const query = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    address: STANDING_ADDRESS,
    topic0: MANDATE_OPENED_TOPIC,
    topic3: subscriberTopic,
    topic0_3_opr: 'and',
  })
  return `${COSTON2_EXPLORER}/api?${query.toString()}`
}

async function fetchRange(account: Address, fromBlock: bigint, toBlock: bigint) {
  const response = await fetch(queryUrl(account, fromBlock, toBlock), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Coston2 explorer log index returned HTTP ${response.status}`)
  const payload = await response.json() as ExplorerLogResponse
  if (payload.status === '0' && payload.message === 'No logs found') return []
  if (payload.status !== '1' || !Array.isArray(payload.result)) {
    throw new Error('Coston2 explorer returned an invalid filtered-log response')
  }
  return payload.result
}

export async function indexedSubscriberMandateIds(account: Address, toBlock: bigint) {
  if (toBlock < DEPLOY_BLOCK) return []

  const ids = new Set<bigint>()
  const ranges: Array<[bigint, bigint]> = [[DEPLOY_BLOCK, toBlock]]
  let requests = 0

  while (ranges.length > 0) {
    if (++requests > MAX_INDEX_REQUESTS) {
      throw new Error(`Coston2 explorer log index exceeded ${MAX_INDEX_REQUESTS} filtered requests`)
    }
    const [fromBlock, rangeEnd] = ranges.pop()!
    const logs = await fetchRange(account, fromBlock, rangeEnd)

    if (logs.length >= EXPLORER_RESULT_LIMIT) {
      if (fromBlock === rangeEnd) {
        throw new Error(`Coston2 explorer returned at least ${EXPLORER_RESULT_LIMIT} matching logs in one block`)
      }
      const midpoint = fromBlock + (rangeEnd - fromBlock) / 2n
      ranges.push([midpoint + 1n, rangeEnd], [fromBlock, midpoint])
      continue
    }

    for (const item of logs) {
      const topics = item.topics
      if (!topics || topics.length < 4) continue
      if (topics[0]?.toLowerCase() !== MANDATE_OPENED_TOPIC) continue
      if (topics[3]?.toLowerCase() !== pad(account, { size: 32 }).toLowerCase()) continue
      const blockNumber = item.blockNumber ? BigInt(item.blockNumber) : undefined
      if (blockNumber === undefined || blockNumber < DEPLOY_BLOCK || blockNumber > toBlock) continue
      ids.add(BigInt(topics[1]))
    }
  }

  return [...ids].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
}

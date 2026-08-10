import { createPublicClient, createWalletClient, getAddress, http, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const coston2 = {
  id: 114,
  name: 'Flare Testnet Coston2',
  nativeCurrency: { name: 'Coston2 Flare', symbol: 'C2FLR', decimals: 18 },
  rpcUrls: { default: { http: ['https://coston2-api.flare.network/ext/C/rpc'] } },
}

export const standingAbi = [
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'mandateCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'priceAdapter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'mandates',
    stateMutability: 'view',
    inputs: [{ name: 'mandateId', type: 'uint256' }],
    outputs: [
      { name: 'planId', type: 'uint256' },
      { name: 'subscriber', type: 'address' },
      { name: 'deposited', type: 'uint256' },
      { name: 'remaining', type: 'uint256' },
      { name: 'nextChargeAt', type: 'uint256' },
      { name: 'lastChargeAt', type: 'uint256' },
      { name: 'canceled', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'plans',
    stateMutability: 'view',
    inputs: [{ name: 'planId', type: 'uint256' }],
    outputs: [
      { name: 'merchant', type: 'address' },
      { name: 'priceUsdMicro', type: 'uint256' },
      { name: 'priceFxrp', type: 'uint256' },
      { name: 'periodSeconds', type: 'uint32' },
      { name: 'active', type: 'bool' },
    ],
  },
  { type: 'function', name: 'charge', stateMutability: 'nonpayable', inputs: [{ name: 'mandateId', type: 'uint256' }], outputs: [] },
  {
    type: 'event',
    name: 'ChargeExecuted',
    inputs: [
      { name: 'mandateId', type: 'uint256', indexed: true },
      { name: 'merchant', type: 'address', indexed: true },
      { name: 'merchantAmount', type: 'uint256', indexed: false },
      { name: 'feeAmount', type: 'uint256', indexed: false },
      { name: 'nextChargeAt', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ChargeBlocked',
    inputs: [
      { name: 'mandateId', type: 'uint256', indexed: true },
      { name: 'remaining', type: 'uint256', indexed: false },
      { name: 'required', type: 'uint256', indexed: false },
    ],
  },
]

export const priceAdapterAbi = [
  {
    type: 'function',
    name: 'getFxrpForUsdMicro',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'usdMicro', type: 'uint256' }],
    outputs: [
      { name: 'fxrpAmount', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
    ],
  },
]

function emit(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`)
}

function toMandate(value) {
  return {
    planId: value[0],
    remaining: value[3],
    nextChargeAt: value[4],
    canceled: value[6],
  }
}

export async function runKeeper({
  publicClient,
  walletClient,
  standing,
  maxMandatesPerRun = 500n,
  scanCursor,
  log = emit,
  parseLogs = (logs) => parseEventLogs({ abi: standingAbi, logs, strict: false }),
}) {
  const [paused, count, block] = await Promise.all([
    publicClient.readContract({ address: standing, abi: standingAbi, functionName: 'paused' }),
    publicClient.readContract({ address: standing, abi: standingAbi, functionName: 'mandateCount' }),
    publicClient.getBlock({ blockTag: 'latest' }),
  ])

  if (paused) {
    log('scan_skipped', { reason: 'protocol_paused', mandateCount: count.toString() })
    return { scanned: 0, submitted: 0, skipped: 0 }
  }

  if (maxMandatesPerRun <= 0n) throw new Error('keeper page size must be positive')
  const pageCount = count === 0n ? 1n : (count + maxMandatesPerRun - 1n) / maxMandatesPerRun
  if (pageCount > 1n && (typeof scanCursor !== 'bigint' || scanCursor < 0n)) {
    throw new Error('KEEPER_SCAN_CURSOR must be a non-negative integer when mandate paging is required')
  }
  const page = pageCount === 1n ? 0n : scanCursor % pageCount
  const firstMandateId = page * maxMandatesPerRun + 1n
  const lastMandateId = count < firstMandateId + maxMandatesPerRun - 1n
    ? count
    : firstMandateId + maxMandatesPerRun - 1n
  if (pageCount > 1n) {
    log('scan_page_selected', {
      page: page.toString(),
      pageCount: pageCount.toString(),
      scanCursor: scanCursor.toString(),
      firstMandateId: firstMandateId.toString(),
      lastMandateId: lastMandateId.toString(),
      mandateCount: count.toString(),
    })
  }

  let submitted = 0
  let skipped = 0
  let failures = 0
  let priceAdapter
  const planCache = new Map()
  for (let mandateId = firstMandateId; mandateId <= lastMandateId; mandateId += 1n) {
    try {
      const mandate = toMandate(await publicClient.readContract({
        address: standing,
        abi: standingAbi,
        functionName: 'mandates',
        args: [mandateId],
      }))
      if (mandate.canceled || mandate.nextChargeAt === 0n || mandate.nextChargeAt > block.timestamp) {
        skipped += 1
        continue
      }

      const cacheKey = mandate.planId.toString()
      let plan = planCache.get(cacheKey)
      if (!plan) {
        plan = await publicClient.readContract({
          address: standing,
          abi: standingAbi,
          functionName: 'plans',
          args: [mandate.planId],
        })
        planCache.set(cacheKey, plan)
      }
      if (!plan[4]) {
        log('charge_withheld', { mandateId: mandateId.toString(), reason: 'plan_inactive' })
        skipped += 1
        continue
      }

      let expectedCharge = plan[2]
      if (plan[1] > 0n) {
        priceAdapter ??= await publicClient.readContract({
          address: standing,
          abi: standingAbi,
          functionName: 'priceAdapter',
        })
        const quote = await publicClient.readContract({
          address: priceAdapter,
          abi: priceAdapterAbi,
          functionName: 'getFxrpForUsdMicro',
          args: [plan[1]],
        })
        expectedCharge = quote[0]
      }
      if (expectedCharge === 0n || expectedCharge > mandate.remaining) {
        log('charge_withheld', {
          mandateId: mandateId.toString(),
          reason: 'insufficient_prepaid_capacity',
          remainingAtomic: mandate.remaining.toString(),
          requiredAtomic: expectedCharge.toString(),
        })
        skipped += 1
        continue
      }

      let request
      try {
        const simulation = await publicClient.simulateContract({
          account: walletClient.account,
          address: standing,
          abi: standingAbi,
          functionName: 'charge',
          args: [mandateId],
        })
        request = simulation.request
      } catch (error) {
        // A concurrent keeper may have charged between the read and simulation.
        const current = toMandate(await publicClient.readContract({
          address: standing,
          abi: standingAbi,
          functionName: 'mandates',
          args: [mandateId],
        }))
        if (current.canceled || current.nextChargeAt > block.timestamp) {
          log('charge_reconciled', { mandateId: mandateId.toString(), reason: 'state_advanced_before_submission' })
          skipped += 1
          continue
        }
        throw error
      }

      const hash = await walletClient.writeContract(request)
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
      if (receipt.status !== 'success') throw new Error(`keeper transaction reverted for mandate ${mandateId}: ${hash}`)
      const events = parseLogs(receipt.logs)
        .filter((event) => event.address.toLowerCase() === standing.toLowerCase())
      const outcome = events.find((event) => event.eventName === 'ChargeExecuted' || event.eventName === 'ChargeBlocked')
      if (!outcome) throw new Error(`keeper transaction ${hash} has no recognized Standing charge outcome`)
      if (outcome.eventName === 'ChargeBlocked') {
        throw new Error(`keeper preflight predicted a payable charge but transaction ${hash} emitted ChargeBlocked`)
      }

      submitted += 1
      log('charge_executed', { mandateId: mandateId.toString(), transactionHash: hash })
    } catch (error) {
      failures += 1
      log('mandate_failed', {
        mandateId: mandateId.toString(),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const scanned = lastMandateId >= firstMandateId ? Number(lastMandateId - firstMandateId + 1n) : 0
  log('scan_complete', {
    mandateCount: count.toString(),
    scanned,
    submitted,
    skipped,
    failures,
    chainTimestamp: block.timestamp.toString(),
  })
  if (failures > 0) throw new Error(`${failures} mandate${failures === 1 ? '' : 's'} failed during keeper scan`)
  return { scanned, submitted, skipped, failures }
}

async function main() {
  const key = process.env.KEEPER_PRIVATE_KEY
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) throw new Error('KEEPER_PRIVATE_KEY must be a 32-byte hex private key')
  const standing = getAddress(process.env.STANDING_ADDRESS ?? '')
  const rpc = process.env.COSTON2_RPC ?? coston2.rpcUrls.default.http[0]
  const account = privateKeyToAccount(key)
  const rawScanCursor = process.env.KEEPER_SCAN_CURSOR
  if (rawScanCursor !== undefined && !/^\d+$/.test(rawScanCursor)) {
    throw new Error('KEEPER_SCAN_CURSOR must be a non-negative integer')
  }
  const scanCursor = rawScanCursor === undefined ? undefined : BigInt(rawScanCursor)
  const transport = http(rpc, { retryCount: 3, timeout: 20_000 })
  const publicClient = createPublicClient({ chain: coston2, transport })
  const walletClient = createWalletClient({ account, chain: coston2, transport })
  const chainId = await publicClient.getChainId()
  if (chainId !== coston2.id) throw new Error(`refusing keeper on chain ${chainId}; expected ${coston2.id}`)
  await runKeeper({ publicClient, walletClient, standing, scanCursor })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    emit('keeper_failed', { message: error instanceof Error ? error.message : String(error) })
    process.exitCode = 1
  })
}

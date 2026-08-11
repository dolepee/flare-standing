import { createPublicClient, createWalletClient, getAddress, http, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const HARD_MAX_MANDATES_PER_RUN = 5n
export const SNAPSHOT_TIMEOUT_MS = 10_000
export const MANDATE_BUDGET_MS = 30_000
export const RPC_CALL_TIMEOUT_MS = 5_000
export const RECEIPT_TIMEOUT_MS = 10_000
export const STANDING_V2_CAPABILITY = '0x95b0f893ac5f1434738e3ebdeada0989770f34f6b1c9bce29e2f2534a7ba1e81'
export const MIN_KEEPER_BALANCE_WEI = 2_000_000_000_000_000_000n
export const HOSTED_KEEPER_MANDATE_ID = 2n

export const coston2 = {
  id: 114,
  name: 'Flare Testnet Coston2',
  nativeCurrency: { name: 'Coston2 Flare', symbol: 'C2FLR', decimals: 18 },
  rpcUrls: { default: { http: ['https://coston2-api.flare.network/ext/C/rpc'] } },
}

export const standingAbi = [
  {
    type: 'function',
    name: 'standingIdentity',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'bytes32' }],
  },
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

function monotonicNowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n)
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return value
}

function normalizeKeeperMandateIds(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('KEEPER_MANDATE_IDS must contain at least one mandate ID')
  }
  const seen = new Set()
  return values.map((value) => {
    if (typeof value !== 'bigint' || value <= 0n) {
      throw new Error('KEEPER_MANDATE_IDS must contain only positive decimal mandate IDs')
    }
    const key = value.toString()
    if (seen.has(key)) throw new Error(`KEEPER_MANDATE_IDS contains duplicate mandate ID ${key}`)
    seen.add(key)
    return value
  })
}

export function parseKeeperMandateIds(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d*(,[1-9]\d*)*$/.test(raw)) {
    throw new Error('KEEPER_MANDATE_IDS must be a nonempty comma-separated list of positive decimal mandate IDs')
  }
  return normalizeKeeperMandateIds(raw.split(',').map((value) => BigInt(value)))
}

export function parseHostedKeeperMandateIds(raw) {
  const mandateIds = parseKeeperMandateIds(raw)
  if (mandateIds.length !== 1 || mandateIds[0] !== HOSTED_KEEPER_MANDATE_ID) {
    throw new Error(`hosted keeper is pinned to mandate ${HOSTED_KEEPER_MANDATE_ID}`)
  }
  return mandateIds
}

function timedCall(operation, timeoutMs, label) {
  const duration = positiveInteger(Math.floor(timeoutMs), `${label} timeout`)
  let timer
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${duration}ms`)), duration)
    }),
  ]).finally(() => clearTimeout(timer))
}

function deadlineCall({ operation, deadlineAt, nowMs, maxWaitMs, label }) {
  const remaining = Math.floor(deadlineAt - nowMs())
  if (remaining <= 0) throw new Error(`${label} skipped: mandate work budget exhausted`)
  return timedCall(operation, Math.min(remaining, maxWaitMs), label)
}

function submissionUncertainError(message) {
  const error = new Error(message)
  error.stopPage = true
  return error
}

export async function runKeeper({
  publicClient,
  walletClient,
  standing,
  mandateIds,
  maxMandatesPerRun = HARD_MAX_MANDATES_PER_RUN,
  scanCursor,
  log = emit,
  parseLogs = (logs) => parseEventLogs({ abi: standingAbi, logs, strict: false }),
  snapshotTimeoutMs = SNAPSHOT_TIMEOUT_MS,
  mandateBudgetMs = MANDATE_BUDGET_MS,
  rpcCallTimeoutMs = RPC_CALL_TIMEOUT_MS,
  receiptTimeoutMs = RECEIPT_TIMEOUT_MS,
  nowMs = monotonicNowMs,
}) {
  standing = getAddress(standing)
  mandateIds = normalizeKeeperMandateIds(mandateIds)
  positiveInteger(snapshotTimeoutMs, 'keeper snapshot timeout')
  positiveInteger(mandateBudgetMs, 'keeper mandate budget')
  positiveInteger(rpcCallTimeoutMs, 'keeper RPC timeout')
  positiveInteger(receiptTimeoutMs, 'keeper receipt timeout')
  if (maxMandatesPerRun <= 0n) throw new Error('keeper page size must be positive')
  if (maxMandatesPerRun > HARD_MAX_MANDATES_PER_RUN) {
    throw new Error(`keeper page size cannot exceed hard limit ${HARD_MAX_MANDATES_PER_RUN}`)
  }

  const [chainId, identity, keeperBalance, paused, count, block] = await timedCall(
    () => Promise.all([
      publicClient.getChainId(),
      publicClient.readContract({ address: standing, abi: standingAbi, functionName: 'standingIdentity' }),
      publicClient.getBalance({ address: walletClient.account.address }),
      publicClient.readContract({ address: standing, abi: standingAbi, functionName: 'paused' }),
      publicClient.readContract({ address: standing, abi: standingAbi, functionName: 'mandateCount' }),
      publicClient.getBlock({ blockTag: 'latest' }),
    ]),
    snapshotTimeoutMs,
    'keeper snapshot',
  )

  if (chainId !== coston2.id) throw new Error(`refusing keeper on chain ${chainId}; expected ${coston2.id}`)
  if (identity[0] !== 2n || identity[1].toLowerCase() !== STANDING_V2_CAPABILITY) {
    throw new Error('refusing keeper: Standing deployment does not expose the exact V2 identity')
  }
  log('keeper_budget', {
    keeper: walletClient.account.address,
    balanceWei: keeperBalance.toString(),
    minimumBalanceWei: MIN_KEEPER_BALANCE_WEI.toString(),
    maxMandatesPerRun: maxMandatesPerRun.toString(),
    allowedMandateIds: mandateIds.map(String),
  })
  if (keeperBalance < MIN_KEEPER_BALANCE_WEI) {
    throw new Error(`keeper balance ${keeperBalance} is below the ${MIN_KEEPER_BALANCE_WEI} wei operating floor`)
  }

  const missingMandateId = mandateIds.find((mandateId) => mandateId > count)
  if (missingMandateId !== undefined) {
    throw new Error(`KEEPER_MANDATE_IDS includes nonexistent mandate ${missingMandateId}; current mandate count is ${count}`)
  }

  if (paused) {
    log('scan_skipped', {
      reason: 'protocol_paused',
      mandateCount: count.toString(),
      allowedMandateIds: mandateIds.map(String),
    })
    return { scanned: 0, submitted: 0, skipped: 0 }
  }

  const allowedCount = BigInt(mandateIds.length)
  const pageCount = (allowedCount + maxMandatesPerRun - 1n) / maxMandatesPerRun
  if (pageCount > 1n && (typeof scanCursor !== 'bigint' || scanCursor < 0n)) {
    throw new Error('KEEPER_SCAN_CURSOR must be a non-negative integer when mandate paging is required')
  }
  const page = pageCount === 1n ? 0n : scanCursor % pageCount
  const pageStart = Number(page * maxMandatesPerRun)
  const pageMandateIds = mandateIds.slice(pageStart, pageStart + Number(maxMandatesPerRun))
  const mandatesInPage = BigInt(pageMandateIds.length)
  // Each later visit to the same page begins one item farther into it. If a
  // submitted transaction has an uncertain result and stops that visit, no
  // single pathological mandate can permanently starve the page tail.
  const pageVisit = (scanCursor ?? 0n) / pageCount
  const startOffset = mandatesInPage === 0n ? 0n : pageVisit % mandatesInPage
  if (pageCount > 1n) {
    log('scan_page_selected', {
      page: page.toString(),
      pageCount: pageCount.toString(),
      scanCursor: scanCursor.toString(),
      firstMandateId: pageMandateIds[0]?.toString() ?? null,
      lastMandateId: pageMandateIds.at(-1)?.toString() ?? null,
      startMandateId: mandatesInPage === 0n ? null : pageMandateIds[Number(startOffset)].toString(),
      mandateCount: count.toString(),
      allowedMandateCount: allowedCount.toString(),
    })
  }

  let submitted = 0
  let skipped = 0
  let failures = 0
  let scanned = 0
  let priceAdapter
  const planCache = new Map()
  for (let pageIndex = 0n; pageIndex < mandatesInPage; pageIndex += 1n) {
    const mandateId = pageMandateIds[Number((startOffset + pageIndex) % mandatesInPage)]
    scanned += 1
    const deadlineAt = nowMs() + mandateBudgetMs
    const call = (label, operation, maxWaitMs = rpcCallTimeoutMs) => deadlineCall({
      operation,
      deadlineAt,
      nowMs,
      maxWaitMs,
      label: `mandate ${mandateId} ${label}`,
    })
    try {
      const mandate = toMandate(await call('state read', () => publicClient.readContract({
        address: standing,
        abi: standingAbi,
        functionName: 'mandates',
        args: [mandateId],
      })))
      if (mandate.canceled || mandate.nextChargeAt === 0n || mandate.nextChargeAt > block.timestamp) {
        skipped += 1
        continue
      }

      const cacheKey = mandate.planId.toString()
      let plan = planCache.get(cacheKey)
      if (!plan) {
        plan = await call('plan read', () => publicClient.readContract({
          address: standing,
          abi: standingAbi,
          functionName: 'plans',
          args: [mandate.planId],
        }))
        planCache.set(cacheKey, plan)
      }
      if (!plan[4]) {
        log('charge_withheld', { mandateId: mandateId.toString(), reason: 'plan_inactive' })
        skipped += 1
        continue
      }

      let expectedCharge = plan[2]
      if (plan[1] > 0n) {
        priceAdapter ??= await call('price adapter read', () => publicClient.readContract({
          address: standing,
          abi: standingAbi,
          functionName: 'priceAdapter',
        }))
        const quote = await call('price quote', () => publicClient.readContract({
          address: priceAdapter,
          abi: priceAdapterAbi,
          functionName: 'getFxrpForUsdMicro',
          args: [plan[1]],
        }))
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
        const simulation = await call('simulation', () => publicClient.simulateContract({
          account: walletClient.account,
          address: standing,
          abi: standingAbi,
          functionName: 'charge',
          args: [mandateId],
        }))
        request = simulation.request
      } catch (error) {
        // A concurrent keeper may have charged between the read and simulation.
        const current = toMandate(await call('simulation reconciliation', () => publicClient.readContract({
          address: standing,
          abi: standingAbi,
          functionName: 'mandates',
          args: [mandateId],
        })))
        if (current.canceled || current.nextChargeAt > block.timestamp) {
          log('charge_reconciled', { mandateId: mandateId.toString(), reason: 'state_advanced_before_submission' })
          skipped += 1
          continue
        }
        throw error
      }

      // Do not start an effectful broadcast unless enough budget remains to
      // submit, wait a bounded interval, and perform one state reconciliation.
      const submissionReserveMs = rpcCallTimeoutMs + receiptTimeoutMs + rpcCallTimeoutMs
      if (deadlineAt - nowMs() < submissionReserveMs) {
        throw new Error(`safe submission withheld: less than ${submissionReserveMs}ms remains`)
      }

      let hash
      try {
        hash = await call('transaction submission', () => walletClient.writeContract(request))
      } catch (error) {
        log('charge_submission_uncertain', {
          mandateId: mandateId.toString(),
          message: error instanceof Error ? error.message : String(error),
        })
        // eth_sendRawTransaction may reach the node before its HTTP response is
        // lost. Stop issuing nonces in this page; a later invocation re-reads
        // onchain mandate state before it can submit another charge.
        throw submissionUncertainError(`keeper submission outcome is uncertain for mandate ${mandateId}`)
      }
      log('charge_submitted', { mandateId: mandateId.toString(), transactionHash: hash })

      let receipt
      try {
        receipt = await call(
          'receipt wait',
          () => publicClient.waitForTransactionReceipt({
            hash,
            confirmations: 1,
            retryCount: 0,
            timeout: receiptTimeoutMs,
          }),
          receiptTimeoutMs,
        )
      } catch (error) {
        // The transaction hash is durable in the log. Re-read the mandate once
        // before reporting it pending, so a mined charge whose receipt RPC was
        // unavailable is accepted without another submission.
        let current
        try {
          current = toMandate(await call('post-submission reconciliation', () => publicClient.readContract({
            address: standing,
            abi: standingAbi,
            functionName: 'mandates',
            args: [mandateId],
          })))
        } catch (reconciliationError) {
          log('charge_submitted_pending', {
            mandateId: mandateId.toString(),
            transactionHash: hash,
            message: error instanceof Error ? error.message : String(error),
            reconciliationMessage: reconciliationError instanceof Error
              ? reconciliationError.message
              : String(reconciliationError),
          })
          throw submissionUncertainError(`keeper transaction ${hash} was submitted but receipt and state reconciliation are unavailable`)
        }
        if (current.canceled || current.nextChargeAt > block.timestamp) {
          log('charge_reconciled', {
            mandateId: mandateId.toString(),
            transactionHash: hash,
            reason: 'state_advanced_after_submission',
          })
          skipped += 1
          continue
        }
        log('charge_submitted_pending', {
          mandateId: mandateId.toString(),
          transactionHash: hash,
          message: error instanceof Error ? error.message : String(error),
        })
        throw submissionUncertainError(`keeper transaction ${hash} was submitted but not reconciled within the receipt budget`)
      }
      if (receipt.status !== 'success') throw new Error(`keeper transaction reverted for mandate ${mandateId}: ${hash}`)
      const events = parseLogs(receipt.logs)
        .filter((event) => event.address.toLowerCase() === standing.toLowerCase())
      const outcome = events.find((event) => event.eventName === 'ChargeExecuted' || event.eventName === 'ChargeBlocked')
      if (!outcome) throw new Error(`keeper transaction ${hash} has no recognized Standing charge outcome`)
      if (outcome.args.mandateId !== mandateId) {
        throw new Error(`keeper transaction ${hash} emitted a charge outcome for the wrong mandate`)
      }
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
      if (error?.stopPage) {
        log('scan_page_stopped', {
          mandateId: mandateId.toString(),
          reason: 'submission_outcome_uncertain',
        })
        break
      }
    }
  }

  log('scan_complete', {
    mandateCount: count.toString(),
    allowedMandateIds: mandateIds.map(String),
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
  const mandateIds = parseHostedKeeperMandateIds(process.env.KEEPER_MANDATE_IDS)
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
  // No transport retries: each action-level deadline above is the retry and
  // reconciliation boundary. This keeps the process wall time provable.
  const transport = http(rpc, { retryCount: 0, timeout: RPC_CALL_TIMEOUT_MS })
  const publicClient = createPublicClient({ chain: coston2, transport })
  const walletClient = createWalletClient({ account, chain: coston2, transport })
  const chainId = await publicClient.getChainId()
  if (chainId !== coston2.id) throw new Error(`refusing keeper on chain ${chainId}; expected ${coston2.id}`)
  await runKeeper({ publicClient, walletClient, standing, mandateIds, scanCursor })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    emit('keeper_failed', { message: error instanceof Error ? error.message : String(error) })
    process.exitCode = 1
  })
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { HARD_MAX_MANDATES_PER_RUN, runKeeper } from '../src/keeper.mjs'

const standing = '0x0000000000000000000000000000000000000001'
const account = { address: '0x0000000000000000000000000000000000000002' }

function harness({ paused = false, due = true, active = true, concurrentAdvance = false, remaining = 10n, price = 1n, timestamp = 1_000n } = {}) {
  const logs = []
  const writes = []
  let mandateReads = 0
  const publicClient = {
    async getChainId() { return 114 },
    async getBalance() { return 5_000_000_000_000_000_000n },
    async getBlock() { return { timestamp } },
    async readContract({ functionName }) {
      if (functionName === 'standingIdentity') {
        return [2n, '0x95b0f893ac5f1434738e3ebdeada0989770f34f6b1c9bce29e2f2534a7ba1e81']
      }
      if (functionName === 'paused') return paused
      if (functionName === 'mandateCount') return 1n
      if (functionName === 'plans') return [account.address, 0n, price, 60, active]
      if (functionName === 'mandates') {
        mandateReads += 1
        const nextChargeAt = concurrentAdvance && mandateReads > 1 ? 1_060n : due ? 999n : 1_060n
        return [1n, account.address, 10n, remaining, nextChargeAt, 900n, false]
      }
      throw new Error(`unexpected read ${functionName}`)
    },
    async simulateContract() {
      if (concurrentAdvance) throw new Error('NotReady')
      return { request: { address: standing, functionName: 'charge', args: [1n] } }
    },
    async waitForTransactionReceipt({ hash }) {
      return {
        status: 'success',
        transactionHash: hash,
        logs: [{ address: standing, eventName: 'ChargeExecuted', args: { mandateId: 1n } }],
      }
    },
  }
  const walletClient = {
    account,
    async writeContract(request) {
      writes.push(request)
      return '0x0000000000000000000000000000000000000000000000000000000000000003'
    },
  }
  const parseLogs = (receiptLogs) => receiptLogs
  return { publicClient, walletClient, writes, logs, parseLogs, log: (event, details) => logs.push({ event, ...details }) }
}

function pagingHarness({ count, timestamp }) {
  const context = harness({ timestamp })
  const mandateIds = []
  context.publicClient.readContract = async ({ functionName, args }) => {
    if (functionName === 'standingIdentity') {
      return [2n, '0x95b0f893ac5f1434738e3ebdeada0989770f34f6b1c9bce29e2f2534a7ba1e81']
    }
    if (functionName === 'paused') return false
    if (functionName === 'mandateCount') return count
    if (functionName === 'mandates') {
      mandateIds.push(args[0])
      return [1n, account.address, 10n, 10n, timestamp + 60n, 900n, false]
    }
    throw new Error(`unexpected read ${functionName}`)
  }
  return { context, mandateIds }
}

function activePagingHarness({
  count,
  timestamp = 1_000n,
  hangingReceiptMandate,
  advanceAfterReceiptTimeout = false,
  hangReconciliation = false,
}) {
  const context = harness({ timestamp })
  const mandateIds = []
  const writes = []
  const readCounts = new Map()
  const hashToMandate = new Map()

  context.publicClient.readContract = async ({ functionName, args }) => {
    if (functionName === 'standingIdentity') {
      return [2n, '0x95b0f893ac5f1434738e3ebdeada0989770f34f6b1c9bce29e2f2534a7ba1e81']
    }
    if (functionName === 'paused') return false
    if (functionName === 'mandateCount') return count
    if (functionName === 'plans') return [account.address, 0n, 1n, 60, true]
    if (functionName === 'mandates') {
      const mandateId = args[0]
      mandateIds.push(mandateId)
      const reads = (readCounts.get(mandateId) ?? 0) + 1
      readCounts.set(mandateId, reads)
      if (hangReconciliation && mandateId === hangingReceiptMandate && reads > 1) return new Promise(() => {})
      const advanced = advanceAfterReceiptTimeout && mandateId === hangingReceiptMandate && reads > 1
      return [1n, account.address, 10n, advanced ? 9n : 10n, advanced ? timestamp + 60n : timestamp - 1n, 900n, false]
    }
    throw new Error(`unexpected read ${functionName}`)
  }
  context.publicClient.simulateContract = async ({ args }) => ({
    request: { address: standing, functionName: 'charge', args },
  })
  context.walletClient.writeContract = async (request) => {
    const mandateId = request.args[0]
    writes.push(mandateId)
    const hash = `0x${mandateId.toString(16).padStart(64, '0')}`
    hashToMandate.set(hash, mandateId)
    return hash
  }
  context.publicClient.waitForTransactionReceipt = async ({ hash }) => {
    const mandateId = hashToMandate.get(hash)
    if (mandateId === hangingReceiptMandate) return new Promise(() => {})
    return {
      status: 'success',
      logs: [{ address: standing, eventName: 'ChargeExecuted', args: { mandateId } }],
    }
  }
  return { context, mandateIds, writes }
}

test('submits exactly one due active mandate', async () => {
  const context = harness()
  const result = await runKeeper({ ...context, standing })
  assert.equal(result.submitted, 1)
  assert.equal(context.writes.length, 1)
  assert.equal(context.logs.some((entry) => entry.event === 'charge_executed'), true)
})

test('does not submit before the due timestamp', async () => {
  const context = harness({ due: false })
  const result = await runKeeper({ ...context, standing })
  assert.equal(result.submitted, 0)
  assert.equal(context.writes.length, 0)
})

test('does not submit while protocol is paused', async () => {
  const context = harness({ paused: true })
  const result = await runKeeper({ ...context, standing })
  assert.equal(result.submitted, 0)
  assert.equal(context.logs.some((entry) => entry.event === 'scan_skipped'), true)
})

test('fails before scanning when the deployment is not the exact V2 capability', async () => {
  const context = harness()
  context.publicClient.readContract = async ({ functionName }) => {
    if (functionName === 'standingIdentity') return [1n, `0x${'00'.repeat(32)}`]
    if (functionName === 'paused') return false
    if (functionName === 'mandateCount') return 1n
    throw new Error(`unexpected read ${functionName}`)
  }
  await assert.rejects(() => runKeeper({ ...context, standing }), /exact V2 identity/)
  assert.equal(context.writes.length, 0)
})

test('fails closed before scanning when the dedicated keeper gas floor is not met', async () => {
  const context = harness()
  context.publicClient.getBalance = async () => 1_999_999_999_999_999_999n
  await assert.rejects(() => runKeeper({ ...context, standing }), /below the .* operating floor/)
  assert.equal(context.writes.length, 0)
})

test('reconciles a competing keeper that advances state first', async () => {
  const context = harness({ concurrentAdvance: true })
  const result = await runKeeper({ ...context, standing })
  assert.equal(result.submitted, 0)
  assert.equal(context.writes.length, 0)
  assert.equal(context.logs.some((entry) => entry.event === 'charge_reconciled'), true)
})

test('withholds an underfunded fixed-price charge without spending gas', async () => {
  const context = harness({ remaining: 1n, price: 2n })
  const result = await runKeeper({ ...context, standing })
  assert.equal(result.submitted, 0)
  assert.equal(context.writes.length, 0)
  assert.equal(context.logs.some((entry) => entry.reason === 'insufficient_prepaid_capacity'), true)
})

test('pages oversized mandate sets instead of halting globally', async () => {
  const { context, mandateIds } = pagingHarness({ count: 6n, timestamp: 1_000n })
  const result = await runKeeper({ ...context, standing, scanCursor: 1n })
  assert.equal(result.scanned, 1)
  assert.equal(result.submitted, 0)
  assert.deepEqual(mandateIds, [6n])
  assert.equal(context.logs.some((entry) => entry.event === 'scan_page_selected'), true)
})

test('fails closed when an oversized scan has no durable cursor', async () => {
  const { context } = pagingHarness({ count: 6n, timestamp: 1_000n })
  await assert.rejects(
    () => runKeeper({ ...context, standing }),
    /KEEPER_SCAN_CURSOR must be a non-negative integer/,
  )
})

test('rejects configuration above the hard five-mandate work bound', async () => {
  const { context } = pagingHarness({ count: 6n, timestamp: 1_000n })
  await assert.rejects(
    () => runKeeper({ ...context, standing, maxMandatesPerRun: HARD_MAX_MANDATES_PER_RUN + 1n, scanCursor: 0n }),
    /keeper page size cannot exceed hard limit 5/,
  )
})

test('missed time slots cannot make the next invocation repeat the previous page', async () => {
  const first = pagingHarness({ count: 6n, timestamp: 1_000n })
  const delayed = pagingHarness({ count: 6n, timestamp: 4_000n })

  await runKeeper({ ...first.context, standing, scanCursor: 40n })
  await runKeeper({ ...delayed.context, standing, scanCursor: 41n })

  assert.equal(first.mandateIds.length, 5)
  assert.equal(first.mandateIds[0], 1n)
  assert.equal(first.mandateIds.at(-1), 5n)
  assert.deepEqual(delayed.mandateIds, [6n])
})

test('consecutive queued invocation cursors cover all 1,001 mandates including the tail', async () => {
  const seen = []
  const pageCount = 201
  for (let index = 0; index < pageCount; index += 1) {
    const page = pagingHarness({ count: 1_001n, timestamp: 1_000n + BigInt(index) })
    await runKeeper({ ...page.context, standing, scanCursor: BigInt(index) })
    seen.push(...page.mandateIds)
  }

  assert.equal(seen.length, 1_001)
  assert.equal(new Set(seen.map(String)).size, 1_001)
  assert.equal(seen[0], 1n)
  assert.equal(seen.at(-1), 1_001n)
})

test('reconciles a submitted charge when receipt polling times out after state advances', async () => {
  const page = activePagingHarness({ count: 1n, hangingReceiptMandate: 1n, advanceAfterReceiptTimeout: true })
  const result = await runKeeper({
    ...page.context,
    standing,
    receiptTimeoutMs: 10,
    rpcCallTimeoutMs: 10,
    mandateBudgetMs: 100,
  })

  assert.deepEqual(page.writes, [1n])
  assert.equal(result.failures, 0)
  assert.equal(page.context.logs.some((entry) => entry.event === 'charge_submitted'), true)
  assert.equal(page.context.logs.some((entry) => entry.event === 'charge_reconciled' && entry.reason === 'state_advanced_after_submission'), true)
})

test('one pathological receipt stops safely but cannot starve later queued pages or its own tail forever', async () => {
  const first = activePagingHarness({ count: 11n, hangingReceiptMandate: 1n })
  const startedAt = Date.now()
  await assert.rejects(
    () => runKeeper({
      ...first.context,
      standing,
      scanCursor: 0n,
      receiptTimeoutMs: 10,
      rpcCallTimeoutMs: 10,
      mandateBudgetMs: 100,
    }),
    /1 mandate failed/,
  )
  assert.ok(Date.now() - startedAt < 500)
  assert.deepEqual(first.writes, [1n])
  assert.equal(first.context.logs.some((entry) => entry.event === 'charge_submitted_pending' && entry.mandateId === '1'), true)

  const next = activePagingHarness({ count: 11n })
  await runKeeper({
    ...next.context,
    standing,
    scanCursor: 1n,
    receiptTimeoutMs: 10,
    rpcCallTimeoutMs: 10,
    mandateBudgetMs: 100,
  })
  assert.deepEqual(next.writes, [6n, 7n, 8n, 9n, 10n])

  const revisit = activePagingHarness({ count: 11n, hangingReceiptMandate: 1n })
  await assert.rejects(
    () => runKeeper({
      ...revisit.context,
      standing,
      scanCursor: 3n,
      receiptTimeoutMs: 10,
      rpcCallTimeoutMs: 10,
      mandateBudgetMs: 100,
    }),
    /1 mandate failed/,
  )
  assert.deepEqual(revisit.writes, [2n, 3n, 4n, 5n, 1n])
})

test('stops the page if both a submitted receipt and its state reconciliation time out', async () => {
  const page = activePagingHarness({ count: 5n, hangingReceiptMandate: 1n, hangReconciliation: true })
  await assert.rejects(
    () => runKeeper({
      ...page.context,
      standing,
      receiptTimeoutMs: 10,
      rpcCallTimeoutMs: 10,
      mandateBudgetMs: 100,
    }),
    /1 mandate failed/,
  )
  assert.deepEqual(page.writes, [1n])
  assert.equal(page.context.logs.some((entry) => entry.event === 'scan_page_stopped'), true)
})

test('isolates one mandate failure until the scan completes', async () => {
  const context = harness()
  context.publicClient.readContract = async ({ functionName, args }) => {
    if (functionName === 'standingIdentity') {
      return [2n, '0x95b0f893ac5f1434738e3ebdeada0989770f34f6b1c9bce29e2f2534a7ba1e81']
    }
    if (functionName === 'paused') return false
    if (functionName === 'mandateCount') return 2n
    if (functionName === 'mandates') return [1n, account.address, 10n, 10n, 999n, 900n, false]
    if (functionName === 'plans') return [account.address, 0n, 1n, 60, true]
    throw new Error(`unexpected read ${functionName} ${args ?? ''}`)
  }
  let simulations = 0
  context.publicClient.simulateContract = async ({ args }) => {
    simulations += 1
    if (args[0] === 1n) throw new Error('rpc failure')
    return { request: { address: standing, functionName: 'charge', args } }
  }
  context.publicClient.waitForTransactionReceipt = async ({ hash }) => ({
    status: 'success',
    transactionHash: hash,
    logs: [{ address: standing, eventName: 'ChargeExecuted', args: { mandateId: 2n } }],
  })
  await assert.rejects(() => runKeeper({ ...context, standing }), /1 mandate failed/)
  assert.equal(simulations, 2)
  assert.equal(context.writes.length, 1)
  assert.equal(context.logs.some((entry) => entry.event === 'scan_complete'), true)
})

test('rejects a successful receipt whose Standing event names another mandate', async () => {
  const context = harness()
  context.publicClient.waitForTransactionReceipt = async ({ hash }) => ({
    status: 'success',
    transactionHash: hash,
    logs: [{ address: standing, eventName: 'ChargeExecuted', args: { mandateId: 2n } }],
  })
  await assert.rejects(() => runKeeper({ ...context, standing }), /1 mandate failed/)
  assert.equal(context.logs.some((entry) => entry.event === 'charge_submitted'), true)
  assert.equal(context.logs.some((entry) => entry.event === 'mandate_failed' && /wrong mandate/.test(entry.message)), true)
})

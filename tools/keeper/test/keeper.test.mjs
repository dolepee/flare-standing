import assert from 'node:assert/strict'
import test from 'node:test'
import { runKeeper } from '../src/keeper.mjs'

const standing = '0x0000000000000000000000000000000000000001'
const account = { address: '0x0000000000000000000000000000000000000002' }

function harness({ paused = false, due = true, active = true, concurrentAdvance = false, remaining = 10n, price = 1n, timestamp = 1_000n } = {}) {
  const logs = []
  const writes = []
  let mandateReads = 0
  const publicClient = {
    async getBlock() { return { timestamp } },
    async readContract({ functionName }) {
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
  assert.equal(context.logs[0].event, 'scan_skipped')
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
  const { context, mandateIds } = pagingHarness({ count: 501n, timestamp: 1_000n })
  const result = await runKeeper({ ...context, standing, maxMandatesPerRun: 500n, scanCursor: 1n })
  assert.equal(result.scanned, 1)
  assert.equal(result.submitted, 0)
  assert.deepEqual(mandateIds, [501n])
  assert.equal(context.logs.some((entry) => entry.event === 'scan_page_selected'), true)
})

test('fails closed when an oversized scan has no durable cursor', async () => {
  const { context } = pagingHarness({ count: 501n, timestamp: 1_000n })
  await assert.rejects(
    () => runKeeper({ ...context, standing, maxMandatesPerRun: 500n }),
    /KEEPER_SCAN_CURSOR must be a non-negative integer/,
  )
})

test('missed time slots cannot make the next invocation repeat the previous page', async () => {
  const first = pagingHarness({ count: 501n, timestamp: 1_000n })
  const delayed = pagingHarness({ count: 501n, timestamp: 4_000n })

  await runKeeper({ ...first.context, standing, maxMandatesPerRun: 500n, scanCursor: 40n })
  await runKeeper({ ...delayed.context, standing, maxMandatesPerRun: 500n, scanCursor: 41n })

  assert.equal(first.mandateIds.length, 500)
  assert.equal(first.mandateIds[0], 1n)
  assert.equal(first.mandateIds.at(-1), 500n)
  assert.deepEqual(delayed.mandateIds, [501n])
})

test('consecutive invocation cursors cover every page above 500 mandates', async () => {
  const pages = [
    pagingHarness({ count: 1_001n, timestamp: 1_000n }),
    pagingHarness({ count: 1_001n, timestamp: 8_200n }),
    pagingHarness({ count: 1_001n, timestamp: 86_500n }),
  ]

  for (const [index, page] of pages.entries()) {
    await runKeeper({
      ...page.context,
      standing,
      maxMandatesPerRun: 500n,
      scanCursor: 90n + BigInt(index),
    })
  }

  assert.equal(pages[0].mandateIds.length, 500)
  assert.equal(pages[0].mandateIds[0], 1n)
  assert.equal(pages[0].mandateIds.at(-1), 500n)
  assert.equal(pages[1].mandateIds.length, 500)
  assert.equal(pages[1].mandateIds[0], 501n)
  assert.equal(pages[1].mandateIds.at(-1), 1_000n)
  assert.deepEqual(pages[2].mandateIds, [1_001n])
})

test('isolates one mandate failure until the scan completes', async () => {
  const context = harness()
  context.publicClient.readContract = async ({ functionName, args }) => {
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
  await assert.rejects(() => runKeeper({ ...context, standing }), /1 mandate failed/)
  assert.equal(simulations, 2)
  assert.equal(context.writes.length, 1)
  assert.equal(context.logs.some((entry) => entry.event === 'scan_complete'), true)
})

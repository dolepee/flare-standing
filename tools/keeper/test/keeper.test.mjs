import assert from 'node:assert/strict'
import test from 'node:test'
import { runKeeper } from '../src/keeper.mjs'

const standing = '0x0000000000000000000000000000000000000001'
const account = { address: '0x0000000000000000000000000000000000000002' }

function harness({ paused = false, due = true, active = true, concurrentAdvance = false, remaining = 10n, price = 1n } = {}) {
  const logs = []
  const writes = []
  let mandateReads = 0
  const publicClient = {
    async getBlock() { return { timestamp: 1_000n } },
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
  const context = harness()
  context.publicClient.readContract = async ({ functionName }) => {
    if (functionName === 'paused') return false
    if (functionName === 'mandateCount') return 501n
    if (functionName === 'mandates') return [1n, account.address, 10n, 10n, 1_060n, 900n, false]
    throw new Error(`unexpected read ${functionName}`)
  }
  const result = await runKeeper({ ...context, standing, maxMandatesPerRun: 500n, pageSeconds: 300n })
  assert.equal(result.scanned, 1)
  assert.equal(result.submitted, 0)
  assert.equal(context.logs.some((entry) => entry.event === 'scan_page_selected'), true)
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

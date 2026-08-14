import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEPLOY_BLOCK } from '../config'
import { indexedSubscriberMandateIds } from './mandateIndex'

const account = '0x1111111111111111111111111111111111111111' as Address
const subscriberTopic = `0x${'0'.repeat(24)}${account.slice(2)}`
const openedTopic = '0x0c21ab881d9fe6e3d35728873ef269e4967cc9a2338df54323578c6bbdce0fd3'

function log(id: number, block = DEPLOY_BLOCK) {
  return {
    blockNumber: `0x${block.toString(16)}`,
    topics: [openedTopic, `0x${id.toString(16).padStart(64, '0')}`, `0x${'0'.repeat(63)}3`, subscriberTopic],
  }
}

function response(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload } as Response
}

describe('indexedSubscriberMandateIds', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses indexed topic filters and splits ranges at the explorer result cap', async () => {
    const toBlock = DEPLOY_BLOCK + 100n
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: '1', message: 'OK', result: Array.from({ length: 1_000 }, () => log(1)) }))
      .mockResolvedValueOnce(response({ status: '1', message: 'OK', result: [log(1)] }))
      .mockResolvedValueOnce(response({ status: '1', message: 'OK', result: [log(4, toBlock)] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(indexedSubscriberMandateIds(account, toBlock)).resolves.toEqual([1n, 4n])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`topic0=${openedTopic}`)
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`topic3=${subscriberTopic}`)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('topic0_3_opr=and')
  })

  it('accepts a valid empty response and fails closed on malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: '0', message: 'No logs found', result: [] })))
    await expect(indexedSubscriberMandateIds(account, DEPLOY_BLOCK)).resolves.toEqual([])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, false, 503)))
    await expect(indexedSubscriberMandateIds(account, DEPLOY_BLOCK)).rejects.toThrow('HTTP 503')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: '1', result: 'unexpected' })))
    await expect(indexedSubscriberMandateIds(account, DEPLOY_BLOCK)).rejects.toThrow('invalid filtered-log response')
  })
})

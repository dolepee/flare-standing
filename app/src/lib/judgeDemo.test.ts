import type { StandingMandate, StandingPlan } from '../contracts'
import { describe, expect, it } from 'vitest'
import { countHistoricalReplayMandates, JUDGE_DEMO, resolveJudgeDemo } from './judgeDemo'

const plan: StandingPlan = {
  id: JUDGE_DEMO.planId,
  merchant: JUDGE_DEMO.merchant,
  priceUsdMicro: 0n,
  priceFxrp: JUDGE_DEMO.priceFxrp,
  periodSeconds: JUDGE_DEMO.periodSeconds,
  active: true,
}

const mandate: StandingMandate = {
  id: JUDGE_DEMO.mandateId,
  planId: JUDGE_DEMO.planId,
  subscriber: JUDGE_DEMO.subscriber,
  deposited: JUDGE_DEMO.deposit,
  remaining: 90_000n,
  lastChargeAt: JUDGE_DEMO.openedAt,
  nextChargeAt: JUDGE_DEMO.firstPaidUntil,
  canceled: false,
}

describe('wallet-free judge demo', () => {
  it('never mislabels new checkout mandates as historical replay evidence', () => {
    const historicalReplay = { ...mandate, id: JUDGE_DEMO.historicalReplayMandateId }
    const futureCheckout = { ...mandate, id: 3n }

    expect(countHistoricalReplayMandates([historicalReplay, mandate, futureCheckout])).toBe(1)
  })

  it('unlocks only the exact paid mandate during its live access window', () => {
    const result = resolveJudgeDemo([plan], [mandate], JUDGE_DEMO.openedAt + 1n)
    expect(result.status).toBe('active')
  })

  it.each([
    ['merchant', { ...plan, merchant: '0x1111111111111111111111111111111111111111' as const }, mandate],
    ['price', { ...plan, priceFxrp: 9_999n }, mandate],
    ['period', { ...plan, periodSeconds: 600 }, mandate],
    ['subscriber', plan, { ...mandate, subscriber: '0x2222222222222222222222222222222222222222' as const }],
    ['deposit', plan, { ...mandate, deposited: 99_999n }],
    ['plan relation', plan, { ...mandate, planId: 1n }],
    ['renewal boundary', plan, { ...mandate, nextChargeAt: JUDGE_DEMO.firstPaidUntil + 1n }],
  ])('fails closed on a mismatched %s binding', (_field, nextPlan, nextMandate) => {
    expect(resolveJudgeDemo([nextPlan], [nextMandate], JUDGE_DEMO.openedAt + 1n).status)
      .toBe('binding_mismatch')
  })

  it('fails closed when the coherent chain snapshot or exact records are absent', () => {
    expect(resolveJudgeDemo([plan], [mandate], 0n).status).toBe('binding_mismatch')
    expect(resolveJudgeDemo([], [mandate], JUDGE_DEMO.openedAt + 1n).status).toBe('binding_mismatch')
    expect(resolveJudgeDemo([plan], [], JUDGE_DEMO.openedAt + 1n).status).toBe('binding_mismatch')
  })

  it('locks before first charge, after cancellation, and at the paid boundary', () => {
    expect(resolveJudgeDemo([plan], [{ ...mandate, lastChargeAt: 0n }], JUDGE_DEMO.openedAt + 1n).status)
      .toBe('awaiting_first_charge')
    expect(resolveJudgeDemo([plan], [{ ...mandate, canceled: true }], JUDGE_DEMO.openedAt + 1n).status)
      .toBe('canceled')
    expect(resolveJudgeDemo([plan], [mandate], JUDGE_DEMO.firstPaidUntil).status)
      .toBe('payment_due')
  })

  it('keeps the already-paid edition active even if no future capacity remains', () => {
    expect(resolveJudgeDemo([plan], [{ ...mandate, remaining: 0n }], JUDGE_DEMO.openedAt + 1n).status)
      .toBe('active')
  })

  it('honors an already-paid window after the merchant stops future renewals', () => {
    expect(resolveJudgeDemo([{ ...plan, active: false }], [mandate], JUDGE_DEMO.openedAt + 1n).status)
      .toBe('active')
  })
})

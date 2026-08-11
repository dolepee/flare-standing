import { COSTON2_EXPLORER } from '../config'
import type { StandingMandate, StandingPlan } from '../contracts'
import { isSameAddress } from './format'

export const JUDGE_DEMO = Object.freeze({
  planId: 2n,
  mandateId: 2n,
  merchant: '0x4BFed030961344Fe9Ac1B59f31D9f29740aD437a',
  subscriber: '0x40Ec816838Cff78FC20a51bB1C33DEC57c67eAe0',
  priceFxrp: 10_000n,
  periodSeconds: 1_209_600,
  deposit: 100_000n,
  openingBlock: 33_907_012n,
  xrplLedger: '19,811,948',
  planCreationBlock: 33_906_897n,
  openedAt: 1_786_426_907n,
  firstPaidUntil: 1_787_636_507n,
  planTransaction: '0xc871264b7208791409a1b77aa8c9609f37aaae33351e481b60bfe40e510a51ac',
  xrplTransaction: '670CB8D1C19E562EF8BF73D006672E2AC56FAF0D29560F025FED68DF315B0595',
  coston2Transaction: '0x4bef577198ef681b4778ce2f023676ee7678a78432b2928f75271815f5ca9de5',
  xrplHref: 'https://testnet.xrpl.org/transactions/670CB8D1C19E562EF8BF73D006672E2AC56FAF0D29560F025FED68DF315B0595',
  planHref: `${COSTON2_EXPLORER}/tx/0xc871264b7208791409a1b77aa8c9609f37aaae33351e481b60bfe40e510a51ac`,
  coston2Href: `${COSTON2_EXPLORER}/tx/0x4bef577198ef681b4778ce2f023676ee7678a78432b2928f75271815f5ca9de5`,
})

export type JudgeDemoReplayStep = {
  id: 'authorize' | 'prove' | 'unlock'
  index: string
  shortLabel: string
  network: string
  title: string
  summary: string
  result: string
  transaction: string
  href: string
  linkLabel: string
}

export const JUDGE_DEMO_REPLAY_STEPS: readonly JudgeDemoReplayStep[] = Object.freeze([
  {
    id: 'authorize',
    index: '01',
    shortLabel: 'Pay XRP',
    network: 'XRPL Testnet',
    title: 'The subscriber authorizes one XRP payment.',
    summary: `A fresh XRPL Testnet account paid 0.3 XRP with the canonical 0xFE Smart Account instruction. The transaction validated with tesSUCCESS in ledger ${JUDGE_DEMO.xrplLedger}.`,
    result: 'Validated · 0.3 XRP · tesSUCCESS',
    transaction: JUDGE_DEMO.xrplTransaction,
    href: JUDGE_DEMO.xrplHref,
    linkLabel: 'Inspect exact XRP authorization',
  },
  {
    id: 'prove',
    index: '02',
    shortLabel: 'Enter Flare',
    network: 'FAssets + Flare Smart Account',
    title: 'Flare proves the payment and funds bounded capacity.',
    summary: 'FDC-backed direct minting charges the 0.1 FTestXRP testnet mint fee and delivers 0.2 FTestXRP to the derived Flare account. The controlled execution places 0.1 inside Standing and leaves 0.1 subscriber-owned with zero residual allowance.',
    result: '0.1 mandate capacity · 0.1 remains subscriber-owned',
    transaction: JUDGE_DEMO.coston2Transaction,
    href: JUDGE_DEMO.coston2Href,
    linkLabel: 'Inspect FAssets + Smart Account execution',
  },
  {
    id: 'unlock',
    index: '03',
    shortLabel: 'Unlock access',
    network: 'Standing V2 · Flare Coston2 testnet',
    title: 'The first cycle pays and the useful result opens immediately.',
    summary: `Inside that Coston2 execution, Standing opens plan 2 / mandate 2, charges exactly 0.01 FTestXRP, leaves 0.09 under the subscriber-controlled mandate, and activates the launch brief through 25 Aug 2026.`,
    result: `Block ${JUDGE_DEMO.openingBlock.toLocaleString('en-US')} · paid now · 0.09 capacity left`,
    transaction: JUDGE_DEMO.coston2Transaction,
    href: JUDGE_DEMO.coston2Href,
    linkLabel: 'Inspect mandate open + first charge',
  },
])

export type JudgeDemoState =
  | { status: 'active'; plan: StandingPlan; mandate: StandingMandate }
  | { status: 'awaiting_first_charge' | 'payment_due' | 'canceled' | 'binding_mismatch'; reason: string }

function exactBinding(plan: StandingPlan, mandate: StandingMandate) {
  return (
    isSameAddress(plan.merchant, JUDGE_DEMO.merchant)
    && plan.priceUsdMicro === 0n
    && plan.priceFxrp === JUDGE_DEMO.priceFxrp
    && plan.periodSeconds === JUDGE_DEMO.periodSeconds
    && mandate.planId === plan.id
    && isSameAddress(mandate.subscriber, JUDGE_DEMO.subscriber)
    && mandate.deposited === JUDGE_DEMO.deposit
    && mandate.remaining <= mandate.deposited
  )
}

export function resolveJudgeDemo(
  plans: StandingPlan[],
  mandates: StandingMandate[],
  chainTimestamp: bigint,
): JudgeDemoState {
  const plan = plans.find((candidate) => candidate.id === JUDGE_DEMO.planId)
  const mandate = mandates.find((candidate) => candidate.id === JUDGE_DEMO.mandateId)

  if (!plan || !mandate || chainTimestamp <= 0n || !exactBinding(plan, mandate)) {
    return {
      status: 'binding_mismatch',
      reason: 'The public Coston2 read does not match the exact published demo mandate and plan.',
    }
  }
  if (mandate.canceled) {
    return { status: 'canceled', reason: 'The subscriber canceled this mandate onchain, so the artifact is locked.' }
  }
  if (mandate.lastChargeAt === 0n) {
    return {
      status: 'awaiting_first_charge',
      reason: 'No successful first charge is recorded for this mandate, so the artifact remains locked.',
    }
  }

  const paidUntil = mandate.lastChargeAt + BigInt(plan.periodSeconds)
  if (mandate.nextChargeAt !== paidUntil) {
    return {
      status: 'binding_mismatch',
      reason: 'The live renewal boundary does not match the immutable plan period.',
    }
  }
  if (chainTimestamp >= paidUntil) {
    return {
      status: 'payment_due',
      reason: 'The paid access window has ended. A successful scheduled charge must settle before the artifact unlocks again.',
    }
  }

  return { status: 'active', plan, mandate }
}

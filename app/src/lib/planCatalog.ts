import type { StandingPlan } from '../contracts'
import { isSameAddress } from './format'

export type PlanProfile = {
  name: string
  merchantName: string
  summary: string
  description: string
  accessTitle: string
  accessSummary: string
  benefits: string[]
  operatorControlled: boolean
}

type CatalogEntry = PlanProfile & {
  merchant: `0x${string}`
}

const REFERENCE_MERCHANT = '0x9C7169BAAB226ABCC5C20d1CabebA8BaB9ea99dd' as const
const DURABLE_DEMO_MERCHANT = '0x4BFed030961344Fe9Ac1B59f31D9f29740aD437a' as const

const planCatalog: Record<string, CatalogEntry> = {
  '1': {
    merchant: REFERENCE_MERCHANT,
    name: 'Fast-Cadence XRP Proof',
    merchantName: 'Standing Coston2 Pilot',
    summary: 'A controlled fast-cadence fixture that proved immediate access and permissionless renewal.',
    description:
      'This controlled testnet fixture recorded an atomic first charge and a later keeper renewal. Its receipts remain public and independently verifiable.',
    accessTitle: 'Fast-cadence XRP receipt',
    accessSummary: 'A block-pinned test edition retained to verify the completed open, first charge, and permissionless renewal.',
    benefits: ['Atomic first-cycle receipt', 'Independent keeper renewal', 'Subscriber exit remains available'],
    operatorControlled: true,
  },
  '2': {
    merchant: DURABLE_DEMO_MERCHANT,
    name: 'XRP Subscription Launch Brief',
    merchantName: 'Standing Durable Pilot',
    summary: 'A 14-day testnet pass kept visibly useful through the judging window.',
    description:
      'Pay the first fixed cycle immediately, retain nine future cycles of bounded capacity, and keep unilateral cancellation and refund rights.',
    accessTitle: 'XRP subscription launch policy',
    accessSummary: 'A creator-ready launch policy unlocked only while the exact long-lived Coston2 mandate is paid.',
    benefits: ['Fourteen-day paid window', 'Fixed 0.01 FTestXRP cycle', 'Onchain cancellation and refund'],
    operatorControlled: true,
  },
}

const fallbackProfile: PlanProfile = {
  name: 'Onchain recurring plan',
  merchantName: 'Unattributed onchain merchant',
  summary: 'A Coston2 plan whose merchant identity is represented only by its address.',
  description:
    'Prepay a bounded testnet mandate, pay only on the onchain schedule, and recover unused FTestXRP after cancellation.',
  accessTitle: 'Subscriber access',
  accessSummary: 'Access is controlled by the latest successful onchain charge.',
  benefits: ['Bounded prepaid capacity', 'Address-owned billing terms', 'Subscriber-controlled cancellation'],
  operatorControlled: false,
}

export function getPlanProfile(plan?: StandingPlan): PlanProfile {
  if (!plan) return fallbackProfile
  const entry = planCatalog[plan.id.toString()]
  if (!entry || !isSameAddress(entry.merchant, plan.merchant)) return fallbackProfile
  const { merchant: _merchant, ...profile } = entry
  return profile
}

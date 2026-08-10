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

const planCatalog: Record<string, CatalogEntry> = {
  '1': {
    merchant: REFERENCE_MERCHANT,
    name: 'Atomic XRP Access Pass',
    merchantName: 'Standing Coston2 Pilot',
    summary: 'A fast testnet pass proving immediate access from an XRP-funded mandate.',
    description:
      'Open a bounded FTestXRP mandate and pay the first cycle atomically, then retain unilateral cancellation and refund rights.',
    accessTitle: 'Atomic XRP subscriber brief',
    accessSummary: 'A test edition unlocked by the first successful charge in the mandate-open transaction.',
    benefits: ['Immediate first-cycle access', 'Bounded recurring capacity', 'Onchain cancellation and refund'],
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

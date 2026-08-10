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
    name: 'Builder Access Pass',
    merchantName: 'Standing Reference Merchant',
    summary: 'A fixed-FTestXRP fixture for testing recurring mandate controls.',
    description:
      'Fund a bounded FTestXRP mandate, let the scheduled charge execute, and retain unilateral cancellation and refund rights.',
    accessTitle: 'Builder operations brief',
    accessSummary: 'A sample member update unlocked by a successful recurring charge.',
    benefits: ['Bounded prepaid capacity', 'Permissionless scheduled charges', 'Onchain cancellation and refund'],
    operatorControlled: true,
  },
  '2': {
    merchant: REFERENCE_MERCHANT,
    name: 'FTSO Creator Pass',
    merchantName: 'Standing Reference Merchant',
    summary: 'A USD-priced test membership settled in FTestXRP using Flare FTSO.',
    description:
      'The plan stays denominated in USD while each successful Coston2 charge resolves to FTestXRP through the Flare price feed.',
    accessTitle: 'Creator member dispatch',
    accessSummary: 'A sample subscriber edition unlocked by the latest successful charge.',
    benefits: ['USD-denominated plan', 'Coston2 FTSO conversion', 'Cancel-anytime mandate'],
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

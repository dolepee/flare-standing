import type { StandingMandate } from '../contracts'

export type EntitlementState = 'active' | 'canceled' | 'payment_due' | 'awaiting_first_charge'

export function entitlementState(
  mandate: StandingMandate,
  periodSeconds: number,
  nowSeconds = BigInt(Math.floor(Date.now() / 1_000)),
): EntitlementState {
  if (mandate.canceled) return 'canceled'
  if (mandate.lastChargeAt === 0n) return 'awaiting_first_charge'
  const paidUntil = mandate.lastChargeAt + BigInt(periodSeconds)
  if (nowSeconds >= paidUntil) return 'payment_due'
  return 'active'
}

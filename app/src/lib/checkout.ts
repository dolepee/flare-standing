import type { StandingPlan } from '../contracts'

export const DEFAULT_USD_PLAN_CAPACITY = 100_000n

export function suggestedPrepaidCapacity(plan: Pick<StandingPlan, 'priceUsdMicro' | 'priceFxrp'>, cycles = 3n) {
  const fixed = plan.priceFxrp > 0n
  const usdPriced = plan.priceUsdMicro > 0n
  if (fixed === usdPriced) throw new Error('Plan pricing is invalid')
  if (cycles <= 0n) throw new Error('Cycle count must be positive')
  return fixed ? plan.priceFxrp * cycles : DEFAULT_USD_PLAN_CAPACITY
}

export function selectInitialChargeCeiling(
  plan: Pick<StandingPlan, 'priceUsdMicro' | 'priceFxrp'>,
  deposit: bigint,
  reviewedUsdCeiling?: bigint,
) {
  if (deposit <= 0n) throw new Error('Prepaid capacity must be positive')
  const fixed = plan.priceFxrp > 0n
  const usdPriced = plan.priceUsdMicro > 0n
  if (fixed === usdPriced) throw new Error('Plan pricing is invalid')

  if (fixed) {
    if (plan.priceFxrp > deposit) throw new Error('Prepaid capacity must cover the fixed initial charge')
    return plan.priceFxrp
  }

  if (!reviewedUsdCeiling || reviewedUsdCeiling <= 0n) {
    throw new Error('Review a positive maximum initial charge')
  }
  if (reviewedUsdCeiling > deposit) {
    throw new Error('Maximum initial charge cannot exceed prepaid capacity')
  }
  return reviewedUsdCeiling
}

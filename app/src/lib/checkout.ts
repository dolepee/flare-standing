import type { StandingPlan } from '../contracts'

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

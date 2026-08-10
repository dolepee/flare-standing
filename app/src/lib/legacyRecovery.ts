import type { Address } from 'viem'
import { HISTORICAL_V1_ADDRESS } from '../config'
import { historicalV1RecoveryAbi, type StandingMandate } from '../contracts'
import { isSameAddress } from './format'

export type LegacyRecoveryAction = 'cancel' | 'withdrawMandate'
export const HISTORICAL_PERSONAL_ACCOUNT_SUBSCRIBER = '0x230068eE8262BE1A7DF36f55Ebb17F64Cc8F7890' as const

export function createLegacyRecoveryRequest(
  action: LegacyRecoveryAction | string,
  mandate: StandingMandate,
  account: Address | undefined,
  correctChain: boolean,
) {
  if (action !== 'cancel' && action !== 'withdrawMandate') {
    throw new Error('Unsupported historical recovery action')
  }
  if (isSameAddress(mandate.subscriber, HISTORICAL_PERSONAL_ACCOUNT_SUBSCRIBER)) {
    throw new Error('XRPL-derived Personal Account recovery is not available in the browser')
  }
  if (!account || !isSameAddress(account, mandate.subscriber)) {
    throw new Error('Connect the original subscriber wallet')
  }
  if (!correctChain) throw new Error('Switch to Coston2 first')

  if (action === 'cancel' && mandate.canceled) {
    throw new Error('Historical mandate is already canceled')
  }
  if (action === 'withdrawMandate' && (!mandate.canceled || mandate.remaining === 0n)) {
    throw new Error('Cancel the historical mandate before withdrawing a nonzero balance')
  }

  return {
    label: action === 'cancel'
      ? `Cancel historical V1 mandate #${mandate.id}`
      : `Withdraw historical V1 mandate #${mandate.id}`,
    address: HISTORICAL_V1_ADDRESS,
    abi: historicalV1RecoveryAbi,
    functionName: action,
    args: [mandate.id] as const,
  }
}

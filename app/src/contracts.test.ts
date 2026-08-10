import { describe, expect, it } from 'vitest'
import { historicalV1RecoveryAbi, standingAbi } from './contracts'

describe('Standing frontend ABI', () => {
  it('exposes only the V2 atomic checkout write', () => {
    const functionNames = standingAbi
      .filter((item) => item.type === 'function')
      .map((item) => item.name)

    expect(functionNames).toContain('openMandateAndCharge')
    expect(functionNames).not.toContain('openMandate')
  })

  it('exposes every lifecycle event emitted by the deployed contract', () => {
    const eventNames = standingAbi
      .filter((item) => item.type === 'event')
      .map((item) => item.name)

    expect(eventNames).toEqual(expect.arrayContaining([
      'PlanCreated',
      'PlanUpdated',
      'MandateOpened',
      'MandateTopUp',
      'MandateCanceled',
      'ChargeExecuted',
      'ChargeBlocked',
      'MandateWithdrawn',
      'MerchantWithdraw',
      'ProtocolWithdraw',
      'PausedSet',
      'OwnershipTransferred',
    ]))
  })

  it('labels ChargeExecuted values as merchant net and protocol fee amounts', () => {
    const chargeExecuted = standingAbi.find((item) => item.type === 'event' && item.name === 'ChargeExecuted')

    expect(chargeExecuted?.inputs.map((input) => input.name)).toEqual([
      'mandateId',
      'merchant',
      'merchantAmount',
      'feeAmount',
      'nextChargeAt',
    ])
  })

  it('limits historical V1 writes to subscriber cancel and canceled-balance withdrawal', () => {
    const functionNames = historicalV1RecoveryAbi
      .filter((item) => item.type === 'function')
      .map((item) => item.name)
    const writeNames = historicalV1RecoveryAbi
      .filter((item) => item.type === 'function' && item.stateMutability !== 'view')
      .map((item) => item.name)

    expect(writeNames).toEqual(['cancel', 'withdrawMandate'])
    expect(functionNames).not.toEqual(expect.arrayContaining([
      'openMandate',
      'openMandateAndCharge',
      'topUp',
      'charge',
      'createPlan',
      'withdrawMerchant',
      'withdrawProtocol',
    ]))
  })
})

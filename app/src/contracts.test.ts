import { describe, expect, it } from 'vitest'
import { standingAbi } from './contracts'

describe('Standing frontend ABI', () => {
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
})

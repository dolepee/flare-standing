import { describe, expect, it } from 'vitest'
import { ATOMIC_PROOF, ATOMIC_REPLAY_STEPS } from './atomicProof'

describe('verified atomic replay', () => {
  it('binds direct mint, mandate open, and first charge to the same Coston2 receipt', () => {
    expect(ATOMIC_REPLAY_STEPS.map((step) => step.id)).toEqual([
      'authorize',
      'mint',
      'activate',
      'recur',
    ])
    expect(ATOMIC_REPLAY_STEPS[1].transaction).toBe(ATOMIC_REPLAY_STEPS[2].transaction)
    expect(ATOMIC_REPLAY_STEPS[3].transaction).toBe(ATOMIC_PROOF.chargeTransaction)
    expect(ATOMIC_PROOF.coston2Transaction).not.toBe(ATOMIC_PROOF.chargeTransaction)
  })

  it('publishes exact testnet explorer links for every transaction claim', () => {
    expect(ATOMIC_PROOF.xrplHref.endsWith(ATOMIC_PROOF.xrplTransaction)).toBe(true)
    expect(ATOMIC_PROOF.coston2Href.endsWith(ATOMIC_PROOF.coston2Transaction)).toBe(true)
    expect(ATOMIC_PROOF.chargeHref.endsWith(ATOMIC_PROOF.chargeTransaction)).toBe(true)
    expect(ATOMIC_PROOF.xrplHref).toContain('testnet.xrpl.org')
    expect(ATOMIC_PROOF.coston2Href).toContain('coston2-explorer.flare.network')
  })
})

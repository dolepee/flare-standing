import { CircleDollarSign, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { STANDING_ADDRESS } from '../config'
import { standingAbi } from '../contracts'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { formatFxrp, parseFxrp } from '../lib/format'

export function MerchantPage() {
  const { account, execute } = useWallet()
  const { state, refresh } = useProtocol()
  const [pricing, setPricing] = useState<'usd' | 'fxrp'>('usd')
  const [price, setPrice] = useState('5')
  const [period, setPeriod] = useState('30')

  async function createPlan(event: FormEvent) {
    event.preventDefault()
    if (!account) return
    const usdMicro = pricing === 'usd' ? BigInt(Math.round(Number(price) * 1_000_000)) : 0n
    const fxrp = pricing === 'fxrp' ? parseFxrp(price) : 0n
    const periodSeconds = Number(period) * 86_400
    await execute({
      label: 'Create merchant plan',
      address: STANDING_ADDRESS,
      abi: standingAbi,
      functionName: 'createPlan',
      args: [usdMicro, fxrp, periodSeconds, account],
    })
    await refresh()
  }

  async function withdraw() {
    await execute({
      label: 'Withdraw merchant balance',
      address: STANDING_ADDRESS,
      abi: standingAbi,
      functionName: 'withdrawMerchant',
      args: [state.merchantBalance],
    })
    await refresh()
  }

  const merchantPlans = state.plans.filter((plan) => plan.merchant.toLowerCase() === account?.toLowerCase())

  return (
    <div className="page">
      <section className="page-heading"><div><span className="eyebrow">Merchant workspace</span><h1>Issue a plan. Claim completed charges.</h1><p>Plans are controlled by the merchant wallet. Standing only applies the fixed protocol fee after a successful charge.</p></div></section>
      <section className="merchant-layout">
        <form className="form-surface" onSubmit={(event) => void createPlan(event)}>
          <div className="section-title"><div><span className="eyebrow">New plan</span><h2>Billing terms</h2></div><Plus aria-hidden="true" /></div>
          <fieldset className="segmented field-segmented">
            <legend>Pricing currency</legend>
            <button type="button" className={pricing === 'usd' ? 'active' : ''} onClick={() => setPricing('usd')}>USD via FTSO</button>
            <button type="button" className={pricing === 'fxrp' ? 'active' : ''} onClick={() => setPricing('fxrp')}>Fixed FXRP</button>
          </fieldset>
          <label>Charge amount<div className="input-with-unit"><input required inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} /><span>{pricing === 'usd' ? 'USD' : 'FXRP'}</span></div></label>
          <label>Billing period<div className="input-with-unit"><input required inputMode="numeric" value={period} onChange={(event) => setPeriod(event.target.value)} /><span>days</span></div></label>
          <button className="button button-primary" type="submit" disabled={!account || Number(price) <= 0 || Number(period) <= 0}>Create plan</button>
          {!account ? <small>Connect the merchant wallet to create a plan.</small> : null}
        </form>
        <div className="merchant-summary">
          <div className="merchant-balance">
            <CircleDollarSign aria-hidden="true" />
            <span>Available to claim</span>
            <strong>{formatFxrp(state.merchantBalance)} FXRP</strong>
            <button className="button button-secondary" type="button" onClick={() => void withdraw()} disabled={!account || state.merchantBalance === 0n}>Withdraw</button>
          </div>
          <div className="merchant-plan-summary">
            <span>Your plans</span><strong>{merchantPlans.length}</strong><small>{merchantPlans.filter((plan) => plan.active).length} active</small>
          </div>
        </div>
      </section>
    </div>
  )
}


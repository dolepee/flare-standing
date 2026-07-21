import { ArrowUpRight, PauseCircle, PlayCircle } from 'lucide-react'
import { useState } from 'react'
import { FXRP_ADDRESS, STANDING_ADDRESS } from '../config'
import { erc20Abi, standingAbi, type StandingPlan } from '../contracts'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { formatFxrp, formatPeriod, formatUsdMicro, isSameAddress, parseFxrp, runUiAction, shortAddress } from '../lib/format'
import { Status } from './Status'

export function PlanRow({ plan }: { plan: StandingPlan }) {
  const [deposit, setDeposit] = useState('3')
  const [expanded, setExpanded] = useState(false)
  const { account, execute } = useWallet()
  const { state, refresh } = useProtocol()
  const price = plan.priceUsdMicro > 0n ? formatUsdMicro(plan.priceUsdMicro) : `${formatFxrp(plan.priceFxrp)} FXRP`
  const isMerchant = isSameAddress(account, plan.merchant)

  async function subscribe() {
    const amount = parseFxrp(deposit)
    if (amount <= 0n) return
    if (state.walletAllowance < amount) {
      await execute({
        label: `Approve ${deposit} FTestXRP`,
        address: FXRP_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [STANDING_ADDRESS, amount],
      })
    }
    await execute({
      label: `Open mandate for plan #${plan.id}`,
      address: STANDING_ADDRESS,
      abi: standingAbi,
      functionName: 'openMandate',
      args: [plan.id, amount],
    })
    setExpanded(false)
    await refresh()
  }

  async function setActive(active: boolean) {
    await execute({
      label: `${active ? 'Activate' : 'Pause'} plan #${plan.id}`,
      address: STANDING_ADDRESS,
      abi: standingAbi,
      functionName: 'setPlanActive',
      args: [plan.id, active],
    })
    await refresh()
  }

  return (
    <article className="plan-row">
      <div className="plan-id">#{plan.id.toString()}</div>
      <div className="plan-main">
        <div className="plan-title-line">
          <strong>{price}</strong>
          <Status tone={plan.active ? 'good' : 'warning'}>{plan.active ? 'Active' : 'Paused'}</Status>
        </div>
        <span>Every {formatPeriod(plan.periodSeconds)} · {shortAddress(plan.merchant)}</span>
      </div>
      <div className="plan-actions">
        {isMerchant ? (
          <button className="icon-button" type="button" onClick={() => runUiAction(setActive(!plan.active))} aria-label={plan.active ? 'Pause plan' : 'Activate plan'}>
            {plan.active ? <PauseCircle aria-hidden="true" /> : <PlayCircle aria-hidden="true" />}
          </button>
        ) : null}
        <button className="button button-secondary" type="button" disabled={!plan.active} onClick={() => setExpanded((value) => !value)}>
          Subscribe <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <div className="inline-action">
          <label htmlFor={`deposit-${plan.id}`}>Prepaid capacity</label>
          <div className="input-with-unit">
            <input id={`deposit-${plan.id}`} inputMode="decimal" value={deposit} onChange={(event) => setDeposit(event.target.value)} />
            <span>FXRP</span>
          </div>
          <button className="button button-primary" type="button" onClick={() => runUiAction(subscribe())} disabled={!account || Number(deposit) <= 0}>
            Approve and open mandate
          </button>
          <small>Two wallet confirmations are required when allowance is insufficient.</small>
        </div>
      ) : null}
    </article>
  )
}

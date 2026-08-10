import { ArrowUpRight, PauseCircle, PlayCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { STANDING_ADDRESS } from '../config'
import { standingAbi, type StandingPlan } from '../contracts'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { formatFxrp, formatPeriod, formatUsdMicro, isSameAddress, runUiAction, shortAddress } from '../lib/format'
import { getPlanProfile } from '../lib/planCatalog'
import { Status } from './Status'

export function PlanRow({ plan }: { plan: StandingPlan }) {
  const { account, execute } = useWallet()
  const { refresh } = useProtocol()
  const price = plan.priceUsdMicro > 0n ? formatUsdMicro(plan.priceUsdMicro) : `${formatFxrp(plan.priceFxrp)} FTestXRP`
  const isMerchant = isSameAddress(account, plan.merchant)
  const profile = getPlanProfile(plan)

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
          <strong>{profile.name}</strong>
          <Status tone={plan.active ? 'good' : 'warning'}>{plan.active ? 'Active' : 'Paused'}</Status>
        </div>
        <span>{price} every {formatPeriod(plan.periodSeconds)} · {profile.operatorControlled ? profile.merchantName : `Onchain merchant ${shortAddress(plan.merchant)}`}</span>
      </div>
      <div className="plan-actions">
        {isMerchant ? (
          <button className="icon-button" type="button" onClick={() => runUiAction(setActive(!plan.active))} aria-label={plan.active ? 'Pause plan' : 'Activate plan'}>
            {plan.active ? <PauseCircle aria-hidden="true" /> : <PlayCircle aria-hidden="true" />}
          </button>
        ) : null}
        {plan.active ? (
          <Link className="button button-secondary" to={`/checkout/${plan.id.toString()}`}>
            Open test checkout <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <button className="button button-secondary" type="button" disabled>Checkout paused</button>
        )}
      </div>
    </article>
  )
}

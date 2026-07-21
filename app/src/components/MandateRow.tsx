import { Ban, CircleDollarSign, RotateCcw, Zap } from 'lucide-react'
import { useState } from 'react'
import { FXRP_ADDRESS, STANDING_ADDRESS } from '../config'
import { erc20Abi, standingAbi, type StandingMandate, type StandingPlan } from '../contracts'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { formatFxrp, formatTime, isSameAddress, parseFxrp, shortAddress } from '../lib/format'
import { Status } from './Status'

export function MandateRow({ mandate, plan }: { mandate: StandingMandate; plan?: StandingPlan }) {
  const [topUp, setTopUp] = useState('1')
  const { account, execute } = useWallet()
  const { state, refresh } = useProtocol()
  const isOwner = isSameAddress(account, mandate.subscriber)
  const due = Number(mandate.nextChargeAt) * 1_000 <= Date.now()

  async function action(functionName: 'cancel' | 'withdrawMandate' | 'charge', label: string) {
    await execute({
      label,
      address: STANDING_ADDRESS,
      abi: standingAbi,
      functionName,
      args: [mandate.id],
    })
    await refresh()
  }

  async function addFunds() {
    const amount = parseFxrp(topUp)
    if (state.walletAllowance < amount) {
      await execute({
        label: `Approve ${topUp} FTestXRP`,
        address: FXRP_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [STANDING_ADDRESS, amount],
      })
    }
    await execute({
      label: `Top up mandate #${mandate.id}`,
      address: STANDING_ADDRESS,
      abi: standingAbi,
      functionName: 'topUp',
      args: [mandate.id, amount],
    })
    await refresh()
  }

  return (
    <article className="mandate-row">
      <div className="mandate-heading">
        <div>
          <span>Mandate #{mandate.id.toString()}</span>
          <strong>{formatFxrp(mandate.remaining)} FXRP</strong>
        </div>
        <Status tone={mandate.canceled ? 'warning' : due ? 'muted' : 'good'}>
          {mandate.canceled ? 'Canceled' : due ? 'Charge due' : 'Funded'}
        </Status>
      </div>
      <dl className="mandate-details">
        <div><dt>Plan</dt><dd>#{mandate.planId.toString()}</dd></div>
        <div><dt>Subscriber</dt><dd title={mandate.subscriber}>{shortAddress(mandate.subscriber)}</dd></div>
        <div><dt>Next charge</dt><dd>{formatTime(mandate.nextChargeAt)}</dd></div>
        <div><dt>Price</dt><dd>{plan?.priceUsdMicro ? `$${Number(plan.priceUsdMicro) / 1_000_000}` : `${formatFxrp(plan?.priceFxrp ?? 0n)} FXRP`}</dd></div>
      </dl>
      <div className="mandate-actions">
        {!mandate.canceled ? (
          <button className="button button-secondary" type="button" disabled={!due || !account} onClick={() => void action('charge', `Charge mandate #${mandate.id}`)}>
            <Zap size={15} aria-hidden="true" /> Run charge
          </button>
        ) : null}
        {isOwner && !mandate.canceled ? (
          <button className="button button-quiet" type="button" onClick={() => void action('cancel', `Cancel mandate #${mandate.id}`)}>
            <Ban size={15} aria-hidden="true" /> Cancel
          </button>
        ) : null}
        {isOwner && mandate.canceled && mandate.remaining > 0n ? (
          <button className="button button-primary" type="button" onClick={() => void action('withdrawMandate', `Withdraw mandate #${mandate.id}`)}>
            <CircleDollarSign size={15} aria-hidden="true" /> Withdraw balance
          </button>
        ) : null}
      </div>
      {isOwner && !mandate.canceled ? (
        <div className="compact-topup">
          <label htmlFor={`topup-${mandate.id}`}>Add capacity</label>
          <div className="input-with-unit"><input id={`topup-${mandate.id}`} value={topUp} onChange={(event) => setTopUp(event.target.value)} /><span>FXRP</span></div>
          <button className="icon-button" type="button" onClick={() => void addFunds()} aria-label="Top up mandate">
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </article>
  )
}


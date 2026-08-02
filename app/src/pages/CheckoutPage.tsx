import { ArrowLeft, Check, ShieldCheck, WalletCards } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { decodeEventLog } from 'viem'
import { Status } from '../components/Status'
import { FXRP_ADDRESS, STANDING_ADDRESS } from '../config'
import { erc20Abi, standingAbi } from '../contracts'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { publicClient } from '../lib/chain'
import { formatFxrp, formatPeriod, formatUsdMicro, parseFxrp, runUiAction, shortAddress } from '../lib/format'
import { getPlanProfile } from '../lib/planCatalog'

export function CheckoutPage() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const { account, connected, correctChain, connect, switchToCoston2, execute } = useWallet()
  const { state, loading, initialized, error, refresh } = useProtocol()
  const [deposit, setDeposit] = useState('3')
  const plan = state.plans.find((candidate) => candidate.id.toString() === planId)
  const profile = getPlanProfile(plan)
  const amount = useMemo(() => {
    try {
      return parseFxrp(deposit)
    } catch {
      return 0n
    }
  }, [deposit])

  async function subscribe() {
    if (!plan || amount <= 0n) return
    if (state.walletAllowance < amount) {
      await execute({
        label: `Approve ${deposit} FTestXRP`,
        address: FXRP_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [STANDING_ADDRESS, amount],
      })
    }
    const hash = await execute({
      label: `Open mandate for ${profile.name}`,
      address: STANDING_ADDRESS,
      abi: standingAbi,
      functionName: 'openMandate',
      args: [plan.id, amount],
    })
    const receipt = await publicClient.getTransactionReceipt({ hash })
    const openedLog = receipt.logs.flatMap((log) => {
      try {
        const decoded = decodeEventLog({ abi: standingAbi, data: log.data, topics: log.topics })
        return decoded.eventName === 'MandateOpened' ? [decoded] : []
      } catch {
        return []
      }
    })[0]
    await refresh()
    const openedId = openedLog?.args && 'mandateId' in openedLog.args ? openedLog.args.mandateId : undefined
    navigate(openedId ? `/access/${openedId.toString()}` : '/mandates')
  }

  if (!initialized && loading) {
    return <div className="page route-loading" aria-live="polite">Loading plan from Coston2…</div>
  }

  if (!initialized && error) {
    return (
      <div className="page route-failure" role="alert">
        <ShieldCheck aria-hidden="true" />
        <h1>Coston2 data is temporarily unavailable.</h1>
        <p>The checkout has not classified this plan. Retry the onchain read before continuing.</p>
        <button className="button button-secondary" type="button" onClick={() => runUiAction(refresh())}>Retry plan read</button>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="page not-found">
        <span>PLAN NOT FOUND</span>
        <h1>This checkout does not match an onchain plan.</h1>
        <Link className="button button-secondary" to="/plans">Back to plans</Link>
      </div>
    )
  }

  const price = plan.priceUsdMicro > 0n ? formatUsdMicro(plan.priceUsdMicro) : `${formatFxrp(plan.priceFxrp)} FXRP`
  const fixedCycles = plan.priceFxrp > 0n && amount > 0n ? amount / plan.priceFxrp : undefined
  const insufficientBalance = connected && amount > state.walletBalance

  return (
    <div className="page checkout-page">
      <Link className="back-link" to="/plans"><ArrowLeft size={15} aria-hidden="true" /> All plans</Link>
      <section className="checkout-layout">
        <div className="checkout-copy">
          <div className="checkout-title-row">
            <span className="eyebrow">{profile.merchantName}</span>
            {profile.operatorControlled ? <Status tone="muted">Controlled pilot</Status> : null}
          </div>
          <h1>{profile.name}</h1>
          <p className="checkout-summary">{profile.description}</p>
          <div className="checkout-price"><strong>{price}</strong><span>every {formatPeriod(plan.periodSeconds)}</span></div>
          <ul className="benefit-list">
            {profile.benefits.map((benefit) => <li key={benefit}><Check size={16} aria-hidden="true" /> {benefit}</li>)}
          </ul>
          <div className="merchant-proof">
            <ShieldCheck size={18} aria-hidden="true" />
            <div><span>Onchain merchant</span><code title={plan.merchant}>{shortAddress(plan.merchant)}</code></div>
          </div>
        </div>
        <aside className="checkout-panel">
          <div className="section-title"><div><span className="eyebrow">Open mandate</span><h2>Set prepaid capacity</h2></div><WalletCards aria-hidden="true" /></div>
          <p>Standing can charge only what this mandate holds. Unused FXRP remains recoverable after cancellation.</p>
          <label htmlFor="checkout-deposit">Prepaid capacity</label>
          <div className="input-with-unit checkout-input">
            <input id="checkout-deposit" inputMode="decimal" value={deposit} onChange={(event) => setDeposit(event.target.value)} />
            <span>FXRP</span>
          </div>
          <div className="checkout-facts">
            <div><span>Plan cadence</span><strong>{formatPeriod(plan.periodSeconds)}</strong></div>
            <div><span>Capacity</span><strong>{fixedCycles !== undefined ? `${fixedCycles.toString()} charge${fixedCycles === 1n ? '' : 's'}` : 'FTSO-priced'}</strong></div>
            <div><span>Current wallet</span><strong>{connected ? `${formatFxrp(state.walletBalance)} FXRP` : 'Not connected'}</strong></div>
          </div>
          {!connected ? (
            <button className="button button-primary checkout-submit" type="button" onClick={() => runUiAction(connect())}>Connect wallet</button>
          ) : !correctChain ? (
            <button className="button button-primary checkout-submit" type="button" onClick={() => runUiAction(switchToCoston2())}>Switch to Coston2</button>
          ) : (
            <button className="button button-primary checkout-submit" type="button" disabled={!plan.active || amount <= 0n || !account || insufficientBalance} onClick={() => runUiAction(subscribe())}>
              Approve and open mandate
            </button>
          )}
          <small>{insufficientBalance ? 'Wallet capacity is below this mandate amount.' : state.walletAllowance < amount ? 'Two wallet confirmations: token approval, then mandate.' : 'One wallet confirmation opens the mandate.'}</small>
          {insufficientBalance ? <a className="checkout-help" href="https://faucet.flare.network/" target="_blank" rel="noreferrer">Get Coston2 test assets</a> : null}
        </aside>
      </section>
    </div>
  )
}

import { ArrowLeft, Check, ShieldCheck, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { decodeEventLog } from 'viem'
import { Coston2Setup } from '../components/Coston2Setup'
import { InactivePlanNotice } from '../components/InactivePlanNotice'
import { Status } from '../components/Status'
import { FXRP_ADDRESS, STANDING_ADDRESS } from '../config'
import { erc20Abi, standingAbi } from '../contracts'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { publicClient } from '../lib/chain'
import { selectInitialChargeCeiling, suggestedPrepaidCapacity } from '../lib/checkout'
import { errorMessage, formatFxrp, formatPeriod, formatUsdMicro, parseFxrp, runUiAction, shortAddress } from '../lib/format'
import { getPlanProfile, isHistoricalReplayPlan } from '../lib/planCatalog'

export function CheckoutPage() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const { account, connected, correctChain, connect, switchToCoston2, execute } = useWallet()
  const { state, loading, initialized, error, refresh } = useProtocol()
  const [deposit, setDeposit] = useState('0.1')
  const [depositEdited, setDepositEdited] = useState(false)
  const [reviewedMaxInitialCharge, setReviewedMaxInitialCharge] = useState('')
  const plan = state.plans.find((candidate) => candidate.id.toString() === planId)
  const profile = getPlanProfile(plan)
  useEffect(() => {
    if (plan && !depositEdited) setDeposit(formatFxrp(suggestedPrepaidCapacity(plan)))
  }, [depositEdited, plan])
  const amount = useMemo(() => {
    try {
      return parseFxrp(deposit)
    } catch {
      return 0n
    }
  }, [deposit])
  const reviewedCeiling = useMemo(() => {
    try {
      return parseFxrp(reviewedMaxInitialCharge)
    } catch {
      return 0n
    }
  }, [reviewedMaxInitialCharge])
  const initialChargeSelection = useMemo(() => {
    if (!plan) return { ceiling: 0n, error: undefined }
    try {
      return {
        ceiling: selectInitialChargeCeiling(plan, amount, plan.priceUsdMicro > 0n ? reviewedCeiling : undefined),
        error: undefined,
      }
    } catch (selectionError) {
      return { ceiling: 0n, error: errorMessage(selectionError) }
    }
  }, [amount, plan, reviewedCeiling])

  async function subscribe() {
    if (!plan?.active || amount <= 0n || initialChargeSelection.error || initialChargeSelection.ceiling <= 0n) return
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
      label: `Open and charge ${profile.name}`,
      address: STANDING_ADDRESS,
      abi: standingAbi,
      functionName: 'openMandateAndCharge',
      args: [plan.id, amount, initialChargeSelection.ceiling],
    })
    const receipt = await publicClient.getTransactionReceipt({ hash })
    const decodedLogs = receipt.logs.flatMap((log) => {
      try {
        return [decodeEventLog({ abi: standingAbi, data: log.data, topics: log.topics })]
      } catch {
        return []
      }
    })
    const openedLog = decodedLogs.find((log) => log.eventName === 'MandateOpened')
    const chargedLog = decodedLogs.find((log) => log.eventName === 'ChargeExecuted')
    const openedId = openedLog?.args && 'mandateId' in openedLog.args ? openedLog.args.mandateId : undefined
    const chargedId = chargedLog?.args && 'mandateId' in chargedLog.args ? chargedLog.args.mandateId : undefined
    if (openedId === undefined || chargedId !== openedId) {
      throw new Error('V2 checkout receipt did not bind MandateOpened and ChargeExecuted')
    }
    await refresh()
    navigate(`/access/${openedId.toString()}`)
  }

  if (!initialized && loading) {
    return <div className="page route-loading" aria-live="polite">Loading plan from Coston2…</div>
  }

  if (error) {
    return (
      <div className="page">
        <Coston2Setup />
        <section className="route-failure" role="alert">
          <ShieldCheck aria-hidden="true" />
          <h1>Coston2 data is temporarily unavailable.</h1>
          <p>The checkout has not classified this plan. The official faucet and network setup remain available above; retry the onchain read before signing anything.</p>
          <button className="button button-secondary" type="button" onClick={() => runUiAction(refresh())}>Retry plan read</button>
        </section>
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

  if (!plan.active) {
    return (
      <div className="page checkout-page">
        <Link className="back-link" to="/plans"><ArrowLeft size={15} aria-hidden="true" /> Testnet checkouts</Link>
        <InactivePlanNotice planId={plan.id} planName={profile.name} historicalProof={isHistoricalReplayPlan(plan)} />
      </div>
    )
  }

  const price = plan.priceUsdMicro > 0n ? formatUsdMicro(plan.priceUsdMicro) : `${formatFxrp(plan.priceFxrp)} FTestXRP`
  const fixedCycles = plan.priceFxrp > 0n && amount > 0n ? amount / plan.priceFxrp : undefined
  const insufficientBalance = connected && amount > state.walletBalance
  const invalidDeposit = deposit.trim().length > 0 && amount <= 0n
  const requiresReviewedCeiling = plan.priceUsdMicro > 0n
  const invalidInitialCharge = Boolean(initialChargeSelection.error)
  const checkoutHelp = insufficientBalance
    ? 'Your wallet needs more FTestXRP. Use the official faucet above, then refresh.'
    : invalidDeposit
      ? 'Enter a positive FTestXRP capacity.'
      : initialChargeSelection.error
        ? initialChargeSelection.error
        : state.walletAllowance < amount
          ? 'Two confirmations: FTestXRP approval, then one atomic open-and-initial-charge transaction.'
          : 'One Coston2 transaction opens the mandate and charges its first cycle immediately.'

  return (
    <div className="page checkout-page">
      <Link className="back-link" to="/plans"><ArrowLeft size={15} aria-hidden="true" /> Testnet checkouts</Link>
      <Coston2Setup />
      <section className="checkout-layout">
        <div className="checkout-copy">
          <div className="checkout-title-row">
            <span className="eyebrow">{profile.merchantName}</span>
            <Status tone="muted">Coston2 testnet</Status>
            <Status tone="good">V2 live</Status>
            {profile.operatorControlled ? <Status tone="muted">Controlled fixture</Status> : null}
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
          <div className="section-title"><div><span className="eyebrow">V2 browser checkout</span><h2>Open with access paid</h2></div><WalletCards aria-hidden="true" /></div>
          <p>The transaction must both open the test mandate and emit its first ChargeExecuted event. Unused FTestXRP remains cancelable and recoverable.</p>
          <label htmlFor="checkout-deposit">Prepaid capacity</label>
          <div className="input-with-unit checkout-input">
            <input id="checkout-deposit" inputMode="decimal" value={deposit} aria-invalid={invalidDeposit} aria-describedby="checkout-deposit-help checkout-help-text" onChange={(event) => { setDepositEdited(true); setDeposit(event.target.value) }} />
            <span>FTestXRP</span>
          </div>
          {plan.priceFxrp > 0n ? (
            <div className="checkout-presets" aria-label="Prepaid cycle presets">
              {[1n, 3n, 10n].map((cycles) => (
                <button key={cycles.toString()} type="button" onClick={() => { setDepositEdited(true); setDeposit(formatFxrp(suggestedPrepaidCapacity(plan, cycles))) }}>
                  {cycles.toString()} cycle{cycles === 1n ? '' : 's'}
                </button>
              ))}
            </div>
          ) : null}
          <small className="field-help" id="checkout-deposit-help">This is your maximum approved exposure. The first charge is bounded separately; unused capacity remains cancelable and recoverable.</small>

          {requiresReviewedCeiling ? (
            <div className="initial-charge-field">
              <label htmlFor="max-initial-charge">Maximum initial charge</label>
              <div className="input-with-unit checkout-input">
                <input id="max-initial-charge" inputMode="decimal" placeholder="Review and enter a ceiling" value={reviewedMaxInitialCharge} aria-invalid={invalidInitialCharge} aria-describedby="max-initial-charge-help checkout-help-text" onChange={(event) => setReviewedMaxInitialCharge(event.target.value)} />
                <span>FTestXRP</span>
              </div>
              <small className="field-help" id="max-initial-charge-help">Required FTSO slippage ceiling. The live USD conversion must be at or below this reviewed amount, and the ceiling cannot exceed your deposit.</small>
              <small className="field-help">V2 does not store a separate ceiling for later FTSO-priced charges. Your prepaid capacity is the total exposure bound; cancel before a later cycle if that model is unsuitable.</small>
            </div>
          ) : (
            <div className="fixed-initial-limit">
              <span>Exact initial-charge ceiling</span>
              <strong>{formatFxrp(plan.priceFxrp)} FTestXRP</strong>
              <small>Fixed-price plans use the exact plan price, never the whole deposit.</small>
            </div>
          )}

          <div className="checkout-facts">
            <div><span>Plan cadence</span><strong>{formatPeriod(plan.periodSeconds)}</strong></div>
            <div><span>Recurring capacity</span><strong>{fixedCycles !== undefined ? `${fixedCycles.toString()} cycle${fixedCycles === 1n ? '' : 's'} at the fixed price` : 'FTSO-priced'}</strong></div>
            <div><span>Maximum approved exposure</span><strong>{amount > 0n ? `${formatFxrp(amount)} FTestXRP` : 'Enter an amount'}</strong></div>
            <div><span>First-charge ceiling</span><strong>{initialChargeSelection.ceiling > 0n ? `${formatFxrp(initialChargeSelection.ceiling, 6)} FTestXRP` : 'Review required'}</strong></div>
            <div><span>Current wallet</span><strong>{connected ? `${formatFxrp(state.walletBalance)} FTestXRP` : 'Not connected'}</strong></div>
          </div>
          {!connected ? (
            <button className="button button-primary checkout-submit" type="button" onClick={() => runUiAction(connect())}>Connect wallet</button>
          ) : !correctChain ? (
            <button className="button button-primary checkout-submit" type="button" onClick={() => runUiAction(switchToCoston2())}>Switch to Coston2</button>
          ) : (
            <button className="button button-primary checkout-submit" type="button" disabled={!plan.active || amount <= 0n || !account || insufficientBalance || invalidInitialCharge} onClick={() => runUiAction(subscribe())}>
              Approve, open and charge
            </button>
          )}
          <small id="checkout-help-text" aria-live="polite">{checkoutHelp}</small>
          {insufficientBalance ? <a className="checkout-help" href="https://faucet.flare.network/" target="_blank" rel="noreferrer">Get more Coston2 test assets</a> : null}
        </aside>
      </section>
    </div>
  )
}

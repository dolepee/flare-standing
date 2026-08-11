import { ArrowLeft, CheckCircle2, Clock3, LockKeyhole, ReceiptText, ShieldX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Status } from '../components/Status'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { entitlementState } from '../lib/entitlement'
import { formatTime, isSameAddress, runUiAction, shortAddress } from '../lib/format'
import { getPlanProfile } from '../lib/planCatalog'

const stateCopy = {
  active: { label: 'Access active', tone: 'good' as const, title: 'Membership verified', detail: 'The latest scheduled charge is inside its paid access window.', icon: CheckCircle2 },
  awaiting_first_charge: { label: 'Charge pending', tone: 'muted' as const, title: 'Waiting for first payment', detail: 'The mandate is funded. Access starts after its first successful scheduled charge.', icon: Clock3 },
  payment_due: { label: 'Payment due', tone: 'warning' as const, title: 'Access paused', detail: 'The next scheduled charge is due and must succeed before access resumes.', icon: LockKeyhole },
  canceled: { label: 'Canceled', tone: 'warning' as const, title: 'Access ended', detail: 'The subscriber canceled this mandate onchain. No later charge can restore access.', icon: ShieldX },
}

const pausedHistoricalCopy = {
  label: 'Historical plan paused',
  tone: 'warning' as const,
  title: 'This historical access pass is retired.',
  detail: 'Its completed open and renewal receipts remain verifiable, but the plan no longer accepts charges. Use the durable live demo for the current paid result.',
  icon: ReceiptText,
}

export function AccessPage() {
  const { mandateId } = useParams()
  const { account, connected, connect } = useWallet()
  const { state, loading, initialized, error, refresh } = useProtocol()
  const [nowSeconds, setNowSeconds] = useState(0n)
  const mandate = state.mandates.find((candidate) => candidate.id.toString() === mandateId)
  const plan = mandate ? state.plans.find((candidate) => candidate.id === mandate.planId) : undefined
  const profile = getPlanProfile(plan)

  useEffect(() => {
    if (state.chainTimestamp === 0n) return
    const chainAnchor = state.chainTimestamp
    const monotonicAnchor = performance.now()
    const updateClock = () => {
      const elapsedSeconds = BigInt(Math.floor((performance.now() - monotonicAnchor) / 1_000))
      setNowSeconds(chainAnchor + elapsedSeconds)
    }
    updateClock()
    const timer = window.setInterval(updateClock, 1_000)
    return () => window.clearInterval(timer)
  }, [state.chainTimestamp])

  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    let inFlight: Promise<void> | undefined

    const runRefresh = () => {
      if (inFlight) return inFlight
      inFlight = refresh().finally(() => {
        inFlight = undefined
      })
      return inFlight
    }
    const schedule = () => {
      timer = window.setTimeout(() => {
        const result = document.visibilityState === 'visible' ? runRefresh() : Promise.resolve()
        void result.finally(() => {
          if (!stopped) schedule()
        })
      }, 10_000)
    }
    const sync = () => {
      if (document.visibilityState === 'visible') void runRefresh()
    }

    void runRefresh().finally(() => {
      if (!stopped) schedule()
    })
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [refresh])

  if (!initialized && loading) {
    return <div className="page route-loading" aria-live="polite">Verifying mandate on Coston2…</div>
  }

  if (error) {
    return (
      <div className="page route-failure" role="alert">
        <ShieldX aria-hidden="true" />
        <h1>Coston2 data is temporarily unavailable.</h1>
        <p>No access decision has been made. Retry the onchain read before continuing.</p>
        <button className="button button-secondary" type="button" onClick={() => runUiAction(refresh())}>Retry mandate read</button>
      </div>
    )
  }

  if (!mandate || !plan) {
    return (
      <div className="page not-found">
        <span>MANDATE NOT FOUND</span>
        <h1>No onchain mandate matches this access link.</h1>
        <Link className="button button-secondary" to="/mandates">Back to mandates</Link>
      </div>
    )
  }

  const chainNow = nowSeconds > state.chainTimestamp ? nowSeconds : state.chainTimestamp
  const entitlement = entitlementState(mandate, plan.periodSeconds, chainNow)
  const historicalPlanPaused = !plan.active && entitlement !== 'active' && entitlement !== 'canceled'
  const copy = historicalPlanPaused ? pausedHistoricalCopy : stateCopy[entitlement]
  const Icon = copy.icon
  const ownsMandate = isSameAddress(account, mandate.subscriber)
  const unlocked = entitlement === 'active' && ownsMandate

  return (
    <div className="page access-page">
      <Link className="back-link" to="/mandates"><ArrowLeft size={15} aria-hidden="true" /> Mandates</Link>
      <section className="access-heading">
        <div>
          <span className="eyebrow">{profile.merchantName}</span>
          <h1>{profile.accessTitle}</h1>
          <p>{profile.accessSummary}</p>
        </div>
        <Status tone={copy.tone}>{copy.label}</Status>
      </section>
      <section className="access-layout">
        <div className={unlocked ? 'entitlement-content content-unlocked' : 'entitlement-content content-locked'}>
          <div className="entitlement-state-icon"><Icon aria-hidden="true" /></div>
          <span className="eyebrow">Mandate-backed access</span>
          <h2>{unlocked ? 'The latest edition is unlocked.' : copy.title}</h2>
          {unlocked ? (
            <div className="member-edition">
              <span>ISSUE 01 · COSTON2</span>
              <h3>Recurring XRP payments without custodial billing credentials</h3>
              <p>Standing keeps the spending boundary in a subscriber-owned Coston2 test mandate. Merchants can collect on schedule, while the subscriber retains the right to cancel and recover unused FTestXRP.</p>
            </div>
          ) : (
            <p>{ownsMandate || !connected ? copy.detail : 'Connect the subscriber wallet to open this paid edition.'}</p>
          )}
          {historicalPlanPaused ? <Link className="button button-primary" to="/demo">Open durable live demo</Link> : null}
          {!connected && !historicalPlanPaused ? <button className="button button-primary" type="button" onClick={() => runUiAction(connect())}>Connect subscriber wallet</button> : null}
        </div>
        <aside className="entitlement-receipt">
          <div className="section-title"><div><span className="eyebrow">Coston2 testnet receipt</span><h2>Mandate #{mandate.id.toString()}</h2></div><ReceiptText aria-hidden="true" /></div>
          <dl>
            <div><dt>Subscriber</dt><dd title={mandate.subscriber}>{shortAddress(mandate.subscriber)}</dd></div>
            <div><dt>Plan</dt><dd>#{mandate.planId.toString()} · {profile.name}</dd></div>
            <div><dt>Plan status</dt><dd>{plan.active ? 'Active' : 'Paused for new charges'}</dd></div>
            <div><dt>Last paid</dt><dd>{mandate.lastChargeAt > 0n ? formatTime(mandate.lastChargeAt) : 'Not charged'}</dd></div>
            <div><dt>Next charge</dt><dd>{formatTime(mandate.nextChargeAt)}</dd></div>
            <div><dt>Cancellation</dt><dd>{mandate.canceled ? 'Final onchain' : 'Available to subscriber'}</dd></div>
          </dl>
          <a className="button button-secondary" href={`https://coston2-explorer.flare.network/address/${mandate.subscriber}`} target="_blank" rel="noreferrer">Inspect subscriber</a>
        </aside>
      </section>
      <p className="reference-note">This reference access surface reads the deployed mandate directly. Production merchants should enforce protected content server-side after wallet authentication.</p>
    </div>
  )
}

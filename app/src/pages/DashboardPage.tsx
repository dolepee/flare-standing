import { ArrowRight, RefreshCw, ShieldCheck, WalletMinimal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Metric } from '../components/Metric'
import { Status } from '../components/Status'
import { STANDING_ADDRESS } from '../config'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { formatFxrp, shortAddress } from '../lib/format'

export function DashboardPage() {
  const { account, connected } = useWallet()
  const { state, loading, error, refresh } = useProtocol()
  const ownedMandates = state.mandates.filter((mandate) => mandate.subscriber.toLowerCase() === account?.toLowerCase())
  const dueCount = state.mandates.filter((mandate) => !mandate.canceled && Number(mandate.nextChargeAt) * 1_000 <= Date.now()).length

  return (
    <div className="page dashboard-page">
      <section className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">Recurring XRP payments</span>
          <h1>Mandates that stop when users say stop.</h1>
          <p>Fund once in FXRP. Charge on schedule. Cancel onchain and withdraw unused capacity without asking a merchant.</p>
        </div>
        <div className="heading-actions">
          <button className="icon-button" type="button" onClick={() => void refresh()} aria-label="Refresh protocol data">
            <RefreshCw size={17} className={loading ? 'spin' : ''} aria-hidden="true" />
          </button>
          <Status tone={error ? 'warning' : loading ? 'muted' : 'good'}>{error ? 'RPC unavailable' : loading ? 'Syncing' : 'Coston2 synced'}</Status>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Protocol metrics">
        <Metric label="Active plans" value={state.plans.filter((plan) => plan.active).length.toString()} detail={`${state.planCount} created`} />
        <Metric label="Mandates" value={state.mandateCount.toString()} detail={`${dueCount} ready to charge`} />
        <Metric label="Protocol custody" value={`${formatFxrp(state.contractBalance)} FXRP`} detail="Prepaid user capacity" />
        <Metric label="Protocol fee" value={`${state.feeBps / 100}%`} detail="Per successful charge" />
      </section>

      <section className="dashboard-band">
        <div className="live-rail">
          <div className="section-title">
            <div>
              <span className="eyebrow">Current cycle</span>
              <h2>{connected ? 'Your payment position' : 'Connect to view your position'}</h2>
            </div>
            <Link className="text-link" to="/mandates">Open mandates <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
          <div className="position-grid">
            <div>
              <WalletMinimal size={18} aria-hidden="true" />
              <span>Wallet FXRP</span>
              <strong>{connected ? formatFxrp(state.walletBalance) : '—'}</strong>
            </div>
            <div>
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Your mandates</span>
              <strong>{connected ? ownedMandates.length : '—'}</strong>
            </div>
            <div>
              <span className="rail-dot" aria-hidden="true" />
              <span>Merchant claim</span>
              <strong>{connected ? `${formatFxrp(state.merchantBalance)} FXRP` : '—'}</strong>
            </div>
          </div>
        </div>
        <aside className="contract-panel">
          <span className="eyebrow">Verified deployment</span>
          <h2>Live contract</h2>
          <code>{shortAddress(STANDING_ADDRESS)}</code>
          <dl>
            <div><dt>Network</dt><dd>Coston2 · 114</dd></div>
            <div><dt>Status</dt><dd>{state.paused ? 'Paused' : 'Accepting mandates'}</dd></div>
            <div><dt>Price freshness</dt><dd>{state.maxPriceAge.toString()}s max</dd></div>
          </dl>
          <Link className="button button-secondary" to="/evidence">Inspect evidence</Link>
        </aside>
      </section>

      <section className="recent-section">
        <div className="section-title">
          <div><span className="eyebrow">Open now</span><h2>Live plans</h2></div>
          <Link className="text-link" to="/plans">View all <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
        <div className="compact-plan-list">
          {state.plans.slice(0, 3).map((plan) => (
            <Link to="/plans" key={plan.id.toString()}>
              <span>Plan #{plan.id.toString()}</span>
              <strong>{plan.priceUsdMicro > 0n ? `$${Number(plan.priceUsdMicro) / 1_000_000}` : `${formatFxrp(plan.priceFxrp)} FXRP`}</strong>
              <Status tone={plan.active ? 'good' : 'warning'}>{plan.active ? 'Active' : 'Paused'}</Status>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}


import { ArrowRight, CheckCircle2, RefreshCw, ShieldCheck, WalletCards, WalletMinimal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AtomicProofReplay } from '../components/AtomicProofReplay'
import { Metric } from '../components/Metric'
import { Status } from '../components/Status'
import { STANDING_ADDRESS } from '../config'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { ATOMIC_PROOF } from '../lib/atomicProof'
import { formatFxrp, runUiAction, shortAddress } from '../lib/format'
import { getPlanProfile } from '../lib/planCatalog'

export function DashboardPage() {
  const { account, connected } = useWallet()
  const { state, loading, initialized, error, refresh } = useProtocol()
  const ownedMandates = state.mandates.filter((mandate) => mandate.subscriber.toLowerCase() === account?.toLowerCase())
  const dueCount = state.mandates.filter((mandate) => !mandate.canceled && mandate.nextChargeAt <= state.chainTimestamp).length
  const replayMandate = state.mandates.find((mandate) => mandate.id === ATOMIC_PROOF.mandateId)
  const replayPlan = state.plans.find((plan) => plan.id === ATOMIC_PROOF.planId)

  return (
    <div className="page dashboard-page">
      <section className="atomic-hero" aria-labelledby="atomic-hero-title">
        <div className="atomic-hero-copy">
          <span className="eyebrow">Verified XRPL → Flare subscription · testnets</span>
          <h1 id="atomic-hero-title">Pay in XRP. Land subscribed on Flare.</h1>
          <p>
            A controlled 1.2 XRP payment was proven through FDC, direct-minted into FTestXRP, then opened and charged a Standing mandate in one Coston2 transaction. The result was immediate paid access with 0.9 FTestXRP left under subscriber control.
          </p>

          <dl className="atomic-facts" aria-label="Verified atomic subscription facts">
            <div><dt>User authorized</dt><dd>1.2 XRP</dd></div>
            <div><dt>Standing deposit</dt><dd>1 FTestXRP</dd></div>
            <div><dt>Immediate result</dt><dd>Mandate #1 paid</dd></div>
            <div><dt>First cycle</dt><dd>0.1 FTestXRP</dd></div>
          </dl>

          <div className="hero-actions">
            <a className="button button-primary" href="#verified-replay">Verify the exact receipts <ArrowRight size={15} aria-hidden="true" /></a>
            <Link className="button button-secondary" to="/checkout/1">Try Coston2 checkout</Link>
          </div>

          <div className="experience-boundary" aria-label="Verified XRP path and browser checkout boundary">
            <div>
              <CheckCircle2 size={18} aria-hidden="true" />
              <span><strong>Immediate proof</strong>The open and first charge share one successful Coston2 receipt.</span>
            </div>
            <div>
              <WalletCards size={18} aria-hidden="true" />
              <span><strong>Live V2 checkout</strong>Use test assets to open and pay a first cycle atomically from an EVM wallet.</span>
            </div>
          </div>
          <p className="claim-boundary">Controlled testnet evidence only: one XRPL Testnet payment plus one Coston2 execution. It is not a single cross-chain transaction, a mainnet deployment, customer adoption, or a browser-execution claim for the XRPL path.</p>
        </div>

        <AtomicProofReplay
          mandate={replayMandate}
          plan={replayPlan}
          chainTimestamp={state.chainTimestamp}
          initialized={initialized}
          loading={loading}
          error={error}
          onRefresh={() => runUiAction(refresh())}
        />
      </section>

      <section className="protocol-snapshot" aria-labelledby="protocol-snapshot-title">
        <div className="section-title snapshot-title">
          <div>
            <span className="eyebrow">Live read · Flare Coston2 testnet</span>
            <h2 id="protocol-snapshot-title">Protocol state, not a production claim</h2>
          </div>
          <div className="heading-actions">
            <button className="icon-button" type="button" onClick={() => runUiAction(refresh())} aria-label="Refresh protocol data">
              <RefreshCw size={17} className={loading ? 'spin' : ''} aria-hidden="true" />
            </button>
            <Status tone={error ? 'warning' : loading ? 'muted' : 'good'}>{error ? 'RPC unavailable' : loading ? 'Syncing' : 'Coston2 synced'}</Status>
          </div>
        </div>

        <div className="metrics-grid" aria-label="Protocol metrics">
          <Metric label="Active Coston2 plans" value={initialized ? state.plans.filter((plan) => plan.active).length.toString() : '—'} detail={initialized ? `${state.planCount} created` : 'Reading testnet'} />
          <Metric label="Testnet mandates" value={initialized ? state.mandateCount.toString() : '—'} detail={initialized ? `${dueCount} due by schedule` : 'Reading testnet'} />
          <Metric label="Protocol custody" value={initialized ? `${formatFxrp(state.contractBalance)} FTestXRP` : '—'} detail="Mandates + accrued claims" />
          <Metric label="Protocol fee" value={initialized ? `${state.feeBps / 100}%` : '—'} detail="Per successful charge" />
        </div>
      </section>

      <section className="dashboard-band">
        <div className="live-rail">
          <div className="section-title">
            <div>
              <span className="eyebrow">Connected-wallet lane</span>
              <h2>{connected ? 'Your Coston2 position' : 'Connect only for live testnet actions'}</h2>
            </div>
            <Link className="text-link" to="/mandates">My mandates <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
          <div className="position-grid">
            <div>
              <WalletMinimal size={18} aria-hidden="true" />
              <span>Wallet FTestXRP</span>
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
              <strong>{connected ? `${formatFxrp(state.merchantBalance)} FTestXRP` : '—'}</strong>
            </div>
          </div>
        </div>
        <aside className="contract-panel">
          <span className="eyebrow">Deployed on testnet</span>
          <h2>Coston2 contract</h2>
          <code>{shortAddress(STANDING_ADDRESS)}</code>
          <dl>
            <div><dt>Network</dt><dd>Coston2 testnet · 114</dd></div>
            <div><dt>Status</dt><dd>{!initialized ? 'Checking' : state.paused ? 'Paused' : 'Accepting test mandates'}</dd></div>
            <div><dt>Price freshness</dt><dd>{initialized ? `${state.maxPriceAge.toString()}s max` : 'Checking'}</dd></div>
          </dl>
          <Link className="button button-secondary" to="/evidence">Inspect all receipts</Link>
        </aside>
      </section>

      <section className="recent-section">
        <div className="section-title">
          <div><span className="eyebrow">Live V2 browser lane · Coston2 testnet</span><h2>Open and pay the first cycle in one transaction</h2></div>
          <Link className="text-link" to="/plans">View all <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
        <div className="compact-plan-list">
          {state.plans.filter((plan) => plan.active).slice(0, 3).map((plan) => (
            <Link to={`/checkout/${plan.id.toString()}`} key={plan.id.toString()}>
              <span>{getPlanProfile(plan).name}</span>
              <strong>{plan.priceUsdMicro > 0n ? `$${Number(plan.priceUsdMicro) / 1_000_000}` : `${formatFxrp(plan.priceFxrp)} FTestXRP`}</strong>
              <Status tone="muted">Coston2 testnet</Status>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

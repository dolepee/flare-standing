import { ArrowRight, CheckCircle2, RefreshCw, ShieldCheck, WalletCards, WalletMinimal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AtomicProofReplay } from '../components/AtomicProofReplay'
import { Metric } from '../components/Metric'
import { Status } from '../components/Status'
import { STANDING_ADDRESS } from '../config'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { formatFxrp, runUiAction, shortAddress } from '../lib/format'
import { countHistoricalReplayMandates, JUDGE_DEMO } from '../lib/judgeDemo'
import { getPlanProfile } from '../lib/planCatalog'

export function DashboardPage() {
  const { account, connected } = useWallet()
  const { state, loading, initialized, error, refresh } = useProtocol()
  const ownedMandates = state.mandates.filter((mandate) => mandate.subscriber.toLowerCase() === account?.toLowerCase())
  const historicalProofCount = countHistoricalReplayMandates(state.mandates)
  const showcaseMandate = state.mandates.find((mandate) => mandate.id === JUDGE_DEMO.mandateId)
  const showcasePlan = state.plans.find((plan) => plan.id === JUDGE_DEMO.planId)

  return (
    <div className="page dashboard-page">
      <section className="atomic-hero" aria-labelledby="atomic-hero-title">
        <div className="atomic-hero-copy">
          <span className="eyebrow">XRP-funded recurring access · Flare Coston2 testnet</span>
          <h1 id="atomic-hero-title">Pay in XRP. Land subscribed on Flare.</h1>
          <p>
            Standing turns an XRP payment into bounded recurring access on Flare. Open the live treasury incident runbook without a wallet, then inspect the verified cross-chain path and cancelable mandate behind it.
          </p>

          <div className="hero-actions">
            <Link className="button button-primary" to="/demo">Open live subscriber demo <ArrowRight size={15} aria-hidden="true" /></Link>
            <a className="button button-secondary" href="#verified-replay">Verify the exact receipts</a>
          </div>

          <dl className="atomic-facts" aria-label="Verified subscription facts">
            <div><dt>User authorized</dt><dd>0.3 XRP</dd></div>
            <div><dt>Standing capacity</dt><dd>0.1 FTestXRP</dd></div>
            <div><dt>Immediate result</dt><dd>Mandate #2 paid</dd></div>
            <div><dt>First cycle</dt><dd>0.01 FTestXRP</dd></div>
          </dl>

          <div className="experience-boundary" aria-label="Verified XRP path and browser checkout boundary">
            <div>
              <CheckCircle2 size={18} aria-hidden="true" />
              <span><strong>Immediate proof</strong>The open and first charge share one successful Coston2 receipt at block {JUDGE_DEMO.openingBlock.toLocaleString('en-US')}; that paid state unlocks the useful result.</span>
            </div>
            <div>
              <WalletCards size={18} aria-hidden="true" />
              <span><strong>Live V2 checkout</strong>Use test assets to open and pay a first cycle atomically from an EVM wallet.</span>
            </div>
          </div>
          <p className="claim-boundary">Controlled testnet evidence only: one XRPL Testnet payment plus one Coston2 execution. It is not a single cross-chain transaction, a mainnet deployment, customer adoption, or a browser-execution claim for the XRPL path.</p>
        </div>

        <AtomicProofReplay
          mandate={showcaseMandate}
          plan={showcasePlan}
          snapshotBlockNumber={state.snapshotBlockNumber}
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
          <Metric
            label="Testnet mandates"
            value={initialized ? state.mandateCount.toString() : '—'}
            detail={initialized ? `${historicalProofCount} historical replay · #${JUDGE_DEMO.mandateId.toString()} durable` : 'Reading testnet'}
          />
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

import { CheckCircle2, ExternalLink, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react'
import { Status } from '../components/Status'
import { useJudgeDemo } from '../hooks/useJudgeDemo'
import { formatFxrp, formatPeriod, runUiAction, shortAddress } from '../lib/format'
import { JUDGE_DEMO } from '../lib/judgeDemo'

function utcTime(timestamp: bigint) {
  return `${new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(Number(timestamp) * 1_000))} UTC`
}

export function DemoPage() {
  const { snapshot, demo, loading, initialized, error, refresh } = useJudgeDemo()

  if (!initialized && loading) {
    return <div className="page route-loading" role="status">Reading the paid mandate from Coston2…</div>
  }

  if (error) {
    return (
      <div className="page route-failure" role="alert">
        <LockKeyhole aria-hidden="true" />
        <span className="eyebrow">Wallet-free live demo · Coston2 testnet</span>
        <h1>The subscriber brief is locked.</h1>
        <p>No access decision is made when the public Coston2 read fails.</p>
        <div className="heading-actions">
          <button className="button button-secondary" type="button" onClick={() => runUiAction(refresh())}>Retry Coston2 read</button>
          <a className="button button-secondary" href={JUDGE_DEMO.xrplHref} target="_blank" rel="noreferrer">Inspect XRP receipt</a>
          <a className="button button-secondary" href={JUDGE_DEMO.coston2Href} target="_blank" rel="noreferrer">Inspect activation receipt</a>
        </div>
      </div>
    )
  }

  if (demo.status !== 'active') {
    return (
      <div className="page route-failure" role="status">
        <LockKeyhole aria-hidden="true" />
        <span className="eyebrow">Wallet-free live demo · Coston2 testnet</span>
        <h1>The subscriber brief is locked.</h1>
        <p>{demo.reason}</p>
        <div className="heading-actions">
          <button className="button button-secondary" type="button" onClick={() => runUiAction(refresh())}>Refresh exact mandate</button>
          <a className="button button-secondary" href={JUDGE_DEMO.coston2Href} target="_blank" rel="noreferrer">Inspect paid activation</a>
        </div>
      </div>
    )
  }

  const { mandate, plan } = demo
  const futureCycles = plan.priceFxrp > 0n ? mandate.remaining / plan.priceFxrp : 0n

  return (
    <div className="page demo-page">
      <section className="demo-hero" aria-labelledby="demo-title">
        <div className="demo-kicker">
          <Status tone="good">Access paid</Status>
          <span>No wallet · no faucet · no transaction</span>
        </div>
        <span className="eyebrow">Live subscriber demo · Flare Coston2 testnet</span>
        <h1 id="demo-title">An XRP payment unlocked this subscriber brief.</h1>
        <p>
          Standing reads one exact 14-day mandate and reveals the controlled artifact only while its latest cycle is paid. This public judge view requires no setup.
        </p>
      </section>

      <div className="demo-atomic-path" aria-label="Verified XRP to paid-access path">
        <a href={JUDGE_DEMO.xrplHref} target="_blank" rel="noreferrer"><span>XRPL</span><strong>0.3 XRP authorized</strong></a>
        <span aria-hidden="true">→</span>
        <div><span>FAssets + Smart Account</span><strong>0.1 deposited · 0.1 subscriber-owned</strong><small>0.1 testnet mint fee</small></div>
        <span aria-hidden="true">→</span>
        <a href={JUDGE_DEMO.coston2Href} target="_blank" rel="noreferrer"><span>Coston2</span><strong>0.01 first cycle paid</strong></a>
      </div>

      <section className="demo-layout" aria-label="Paid artifact and live mandate receipt">
        <article className="demo-artifact" aria-labelledby="demo-artifact-title">
          <header className="demo-artifact-header">
            <div>
              <span>XRP SUBSCRIPTION LAUNCH BRIEF</span>
              <strong>LIVE REFERENCE · PLAN #{plan.id.toString()} · MANDATE #{mandate.id.toString()}</strong>
            </div>
            <div className="demo-artifact-seal"><CheckCircle2 aria-hidden="true" /> Unlocked</div>
          </header>

          <div className="demo-article">
            <span className="eyebrow">For XRP creators and communities</span>
            <h2 id="demo-artifact-title">A launch-ready policy for bounded recurring access.</h2>
            <p>This live reference turns the paid mandate into terms a creator can publish before accepting subscribers.</p>
            <ol className="demo-rules">
              <li><span>01</span><div><strong>Publish the ceiling before checkout.</strong><p>The live reference charges {formatFxrp(plan.priceFxrp, 6)} FTestXRP every {formatPeriod(plan.periodSeconds)} from a {formatFxrp(mandate.deposited, 6)} FTestXRP prepaid cap. After immediate access, {futureCycles.toString()} fixed-price cycles remain.</p></div></li>
              <li><span>02</span><div><strong>Make exit and failure boring.</strong><p>The subscriber can cancel without merchant permission and recover every unused unit. An underfunded charge creates no debt; access simply pauses at the paid-through boundary.</p></div></li>
              <li><span>03</span><div><strong>Automate collection without keeper custody.</strong><p>Any keeper may submit a due charge, but cannot charge early, reprice the plan, or withdraw subscriber capacity. Private services verify the paid window server-side.</p></div></li>
            </ol>
          </div>

          <footer className="demo-unlock">
            <ShieldCheck aria-hidden="true" />
            <span><strong>Launch policy verified from live chain state</strong>Paid through {utcTime(mandate.nextChargeAt)}</span>
          </footer>
        </article>

        <aside className="demo-receipt" aria-labelledby="demo-receipt-title">
          <div className="demo-receipt-heading">
            <div><span className="eyebrow">Coherent public read</span><h2 id="demo-receipt-title">Mandate #{mandate.id.toString()} now</h2></div>
            <button className="icon-button" type="button" onClick={() => runUiAction(refresh())} aria-label="Refresh live demo mandate from Coston2">
              <RefreshCw size={16} className={loading ? 'spin' : ''} aria-hidden="true" />
            </button>
          </div>
          <dl>
            <div><dt>State</dt><dd><Status tone="good">Paid · active</Status></dd></div>
            <div><dt>Capacity left</dt><dd>{formatFxrp(mandate.remaining, 6)} of {formatFxrp(mandate.deposited, 6)} FTestXRP</dd></div>
            <div><dt>Prepaid capacity</dt><dd>{futureCycles.toString()} cycles at current fixed price</dd></div>
            <div><dt>Renewals</dt><dd>{plan.active ? 'Enabled on schedule' : 'Paused for future cycles'}</dd></div>
            <div><dt>Last charged</dt><dd>{utcTime(mandate.lastChargeAt)}</dd></div>
            <div><dt>Paid through</dt><dd>{utcTime(mandate.nextChargeAt)}</dd></div>
            <div><dt>Subscriber</dt><dd title={mandate.subscriber}>{shortAddress(mandate.subscriber)}</dd></div>
            <div><dt>Snapshot block</dt><dd>#{snapshot.snapshotBlockNumber.toLocaleString('en-US')}</dd></div>
          </dl>
          <div className="demo-proof-links">
            <a className="button button-secondary" href={JUDGE_DEMO.xrplHref} target="_blank" rel="noreferrer">
              Inspect XRP payment <ExternalLink size={14} aria-hidden="true" />
            </a>
            <a className="button button-secondary" href={JUDGE_DEMO.coston2Href} target="_blank" rel="noreferrer">
              Inspect atomic activation <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
          <p>Exact public read from Coston2 block {snapshot.snapshotBlockNumber.toLocaleString('en-US')}. The activation receipt is a controlled testnet proof at block {JUDGE_DEMO.openingBlock.toLocaleString('en-US')}.</p>
        </aside>
      </section>

      <p className="demo-boundary">This route publicly demonstrates mandate-state gating. Production merchants should additionally authenticate subscriber ownership before returning private content. No mainnet funds or customer-adoption claim is made.</p>
    </div>
  )
}

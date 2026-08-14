import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react'
import { Status } from '../components/Status'
import { useJudgeDemo } from '../hooks/useJudgeDemo'
import { formatFxrp, runUiAction, shortAddress } from '../lib/format'
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
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const manualCopyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (copyState !== 'failed') return
    manualCopyRef.current?.focus()
    manualCopyRef.current?.select()
  }, [copyState])

  if (!initialized && loading) {
    return <div className="page route-loading" role="status">Reading the paid mandate from Coston2…</div>
  }

  if (error) {
    return (
      <div className="page route-failure" role="alert">
        <LockKeyhole aria-hidden="true" />
        <span className="eyebrow">Wallet-free live demo · Coston2 testnet</span>
        <h1>The treasury runbook is locked.</h1>
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
        <h1>The treasury runbook is locked.</h1>
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
  const creatorRunbook = [
    'XRP CREATOR TREASURY INCIDENT RUNBOOK',
    '',
    'FIRST 15 MINUTES',
    '1. Stop publishing payment links and disable affected automation. Do not delete logs.',
    '2. Move unaffected authority to a clean device and require a second reviewer for every recovery transaction.',
    '3. Record the incident start time, affected addresses, chain, latest known-good transaction and current balances.',
    '',
    'EVIDENCE PACK',
    '- Export transaction hashes, block or ledger numbers, destination tags/memos, token contracts and signed operator actions.',
    '- Record facts separately from assumptions. Preserve failed and successful receipts.',
    '- Never request a seed phrase, private key or remote-screen access from a community member.',
    '',
    'PUBLIC STATUS TEMPLATE',
    'We are investigating a treasury/payment incident affecting [scope] since [UTC time]. Do not send funds or trust DMs. Verified updates will appear only at [official channel]. Next update: [UTC time].',
    '',
    'RECOVERY GATE',
    '- Reconcile expected liabilities against actual custody before reopening.',
    '- Test the recovery path with test assets, then require two-person review for production actions.',
    '- Publish a final incident timeline and rotate every credential exposed to the affected environment.',
  ].join('\n')

  async function copyCreatorTerms() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
        await navigator.clipboard.writeText(creatorRunbook)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <div className="page demo-page">
      <section className="demo-hero" aria-labelledby="demo-title">
        <div className="demo-kicker">
          <Status tone="good">Access paid</Status>
          <span>No wallet · no faucet · no transaction</span>
        </div>
        <span className="eyebrow">Live subscriber demo · Flare Coston2 testnet</span>
        <h1 id="demo-title">An XRP payment unlocked a treasury incident runbook.</h1>
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
            <span>XRP CREATOR TREASURY RUNBOOK</span>
              <strong>LIVE REFERENCE · PLAN #{plan.id.toString()} · MANDATE #{mandate.id.toString()}</strong>
            </div>
            <div className="demo-artifact-seal"><CheckCircle2 aria-hidden="true" /> Unlocked</div>
          </header>

          <div className="demo-article">
            <span className="eyebrow">For XRP creators and community treasuries</span>
            <h2 id="demo-artifact-title">Contain a payment incident without losing the evidence.</h2>
            <p>A compact operating runbook for the first response, evidence pack, public status update and recovery gate.</p>
            <div className="demo-copy-ready">
              <div>
                <span className="eyebrow">Ready-to-use response pack</span>
                <strong>Contain · preserve · communicate · recover</strong>
                <small>Includes a public status template and a two-person reopening gate.</small>
              </div>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void copyCreatorTerms()}
                aria-describedby="demo-copy-status"
              >
                {copyState === 'copied' ? <CheckCircle2 size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                {copyState === 'copied' ? 'Runbook copied' : 'Copy runbook'}
              </button>
            </div>
            <p className="demo-copy-status" id="demo-copy-status" role="status" aria-live="polite">
              {copyState === 'copied' ? 'Treasury incident runbook copied to the clipboard.' : copyState === 'failed' ? 'Automatic copy was blocked. The runbook is selected below; press Command+C or Control+C to copy it.' : ''}
            </p>
            {copyState === 'failed' ? (
              <label className="demo-copy-fallback">
                <span>Manual copy fallback</span>
                <textarea
                  ref={manualCopyRef}
                  readOnly
                  rows={10}
                  value={creatorRunbook}
                  aria-label="Treasury incident runbook to copy manually"
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            ) : null}
            <ol className="demo-rules">
              <li><span>01</span><div><strong>Contain before explaining.</strong><p>Stop affected payment links and automation, preserve logs, and move unaffected authority to a clean device with a second reviewer.</p></div></li>
              <li><span>02</span><div><strong>Build a fact-only evidence pack.</strong><p>Record addresses, transaction hashes, ledgers or blocks, token contracts, timestamps and balances. Keep assumptions in a separate section.</p></div></li>
              <li><span>03</span><div><strong>Reopen only after reconciliation.</strong><p>Match actual custody to expected liabilities, test recovery with test assets, rotate exposed credentials and publish the final timeline.</p></div></li>
            </ol>
          </div>

          <footer className="demo-unlock">
            <ShieldCheck aria-hidden="true" />
            <span><strong>Useful runbook unlocked by live chain state</strong>Paid through {utcTime(mandate.nextChargeAt)}</span>
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
              Inspect Coston2 activation <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
          <p>Exact public read from Coston2 block {snapshot.snapshotBlockNumber.toLocaleString('en-US')}. The activation receipt is a controlled testnet proof at block {JUDGE_DEMO.openingBlock.toLocaleString('en-US')}.</p>
        </aside>
      </section>

      <p className="demo-boundary">This route publicly demonstrates mandate-state gating. Production merchants should additionally authenticate subscriber ownership before returning private content. No mainnet funds or customer-adoption claim is made.</p>
    </div>
  )
}

import { Ban, CircleDollarSign, ExternalLink, History, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Status } from '../components/Status'
import { COSTON2_EXPLORER, HISTORICAL_V1_ADDRESS } from '../config'
import type { StandingMandate } from '../contracts'
import { useHistoricalV1 } from '../hooks/useHistoricalV1'
import { formatFxrp, formatTime, isSameAddress, runUiAction, shortAddress } from '../lib/format'
import { createLegacyRecoveryRequest, HISTORICAL_PERSONAL_ACCOUNT_SUBSCRIBER, type LegacyRecoveryAction } from '../lib/legacyRecovery'
import { useWallet } from '../context/WalletContext'

export function LegacyRecoveryPage() {
  const { account, connected, correctChain, connect, switchToCoston2, execute } = useWallet()
  const { state, loading, initialized, error, refresh } = useHistoricalV1()

  async function recover(action: LegacyRecoveryAction, mandate: StandingMandate) {
    const request = createLegacyRecoveryRequest(action, mandate, account, correctChain)
    await execute(request)
    await refresh()
  }

  if (!initialized && loading) {
    return <div className="page route-loading" aria-live="polite">Reading historical V1 mandates from Coston2…</div>
  }

  if (error) {
    return (
      <div className="page route-failure" role="alert">
        <History aria-hidden="true" />
        <h1>Historical V1 data is temporarily unavailable.</h1>
        <p>No recovery action is available until the retired contract can be read again.</p>
        <button className="button button-secondary" type="button" onClick={() => runUiAction(refresh())}>Retry V1 read</button>
      </div>
    )
  }

  return (
    <div className="page legacy-recovery-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Historical recovery · Coston2 testnet · V1</span>
          <h1>Exit an old mandate without reopening it.</h1>
          <p>This isolated route reads the retired V1 contract and supports only browser-controlled subscriber EOAs. It cannot recover XRPL-derived Personal or Smart Accounts; no Smart Account recovery workflow is available in this browser UI.</p>
        </div>
        <Link className="button button-secondary" to="/mandates">Back to current V2 mandates</Link>
      </section>

      <section className="receipt-boundary" aria-label="Historical recovery safety boundary">
        <div><strong>Read-only by default</strong><span>Anyone may inspect V1 state. No wallet is needed and no transaction is prepared.</span></div>
        <div><strong>Two browser-EOA exits only</strong><span>An original EOA subscriber may cancel, then withdraw its canceled balance. Opening, funding, charging, merchant actions, and Smart Account recovery are unavailable.</span></div>
      </section>

      <section className="testnet-setup" aria-labelledby="legacy-recovery-setup-title">
        <div className="testnet-setup-copy">
          <span className="eyebrow">Retired contract boundary</span>
          <h2 id="legacy-recovery-setup-title">Prove ownership before any V1 write</h2>
          <p><code>{HISTORICAL_V1_ADDRESS}</code></p>
        </div>
        <ol>
          <li><History size={17} aria-hidden="true" /><span><strong>Inspect V1</strong>{state.mandateCount.toString()} historical mandates at block #{state.snapshotBlockNumber.toLocaleString('en-US')}</span></li>
          <li><ShieldCheck size={17} aria-hidden="true" /><span><strong>Match subscriber</strong>Only the original browser-EOA subscriber sees an exit control</span></li>
          <li><span className="setup-step" aria-hidden="true">3</span><span><strong>Use Coston2</strong>Wallet network is rechecked before signing</span></li>
        </ol>
        <div className="testnet-setup-actions">
          {!connected ? (
            <button className="button button-primary" type="button" onClick={() => runUiAction(connect())}>Connect subscriber</button>
          ) : !correctChain ? (
            <button className="button button-primary" type="button" onClick={() => runUiAction(switchToCoston2())}>Switch to Coston2</button>
          ) : (
            <Status tone="good">Coston2 ready</Status>
          )}
          <a className="button button-secondary" href={`${COSTON2_EXPLORER}/address/${HISTORICAL_V1_ADDRESS}`} target="_blank" rel="noreferrer">
            Inspect V1 contract <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="mandate-grid" aria-busy={loading} aria-label="Historical V1 mandates">
        {state.mandates.map((mandate) => {
          const plan = state.plans.find((candidate) => candidate.id === mandate.planId)
          const isPersonalAccount = isSameAddress(mandate.subscriber, HISTORICAL_PERSONAL_ACCOUNT_SUBSCRIBER)
          const isOwner = !isPersonalAccount && isSameAddress(account, mandate.subscriber)
          return (
            <article className="mandate-row" key={mandate.id.toString()}>
              <div className="mandate-heading">
                <div><span>Historical V1 mandate #{mandate.id.toString()}</span><strong>{formatFxrp(mandate.remaining)} FTestXRP</strong></div>
                <Status tone={mandate.canceled || isPersonalAccount ? 'muted' : 'warning'}>{isPersonalAccount ? 'Personal Account · read only' : mandate.canceled ? 'Canceled' : 'Recovery open'}</Status>
              </div>
              <dl className="mandate-details">
                <div><dt>Plan</dt><dd>#{mandate.planId.toString()}</dd></div>
                <div><dt>Subscriber</dt><dd title={mandate.subscriber}>{shortAddress(mandate.subscriber)}</dd></div>
                <div><dt>Merchant</dt><dd title={plan?.merchant}>{plan ? shortAddress(plan.merchant) : 'Unknown'}</dd></div>
                <div><dt>Last charged</dt><dd>{mandate.lastChargeAt > 0n ? formatTime(mandate.lastChargeAt) : 'Never'}</dd></div>
              </dl>
              <div className="mandate-actions">
                {isOwner && !mandate.canceled ? (
                  <button className="button button-quiet" type="button" disabled={!correctChain} onClick={() => runUiAction(recover('cancel', mandate))}>
                    <Ban size={15} aria-hidden="true" /> Cancel V1 mandate
                  </button>
                ) : null}
                {isOwner && mandate.canceled && mandate.remaining > 0n ? (
                  <button className="button button-primary" type="button" disabled={!correctChain} onClick={() => runUiAction(recover('withdrawMandate', mandate))}>
                    <CircleDollarSign size={15} aria-hidden="true" /> Withdraw canceled balance
                  </button>
                ) : null}
              </div>
              {isPersonalAccount ? <p className="reference-note">This funded record belongs to an XRPL-derived Personal Account. A browser EOA cannot recover it, and the original Smart Account execution path is not implemented here.</p> : null}
              {!isOwner && !isPersonalAccount ? <p className="reference-note">Read-only record. Connect the original browser-controlled EOA subscriber to expose an eligible recovery control.</p> : null}
              {isOwner && !correctChain ? <p className="reference-note">Switch the connected wallet to Coston2 before signing a recovery action.</p> : null}
              {isOwner && mandate.canceled && mandate.remaining === 0n ? <p className="reference-note">Recovery complete. No V1 balance remains.</p> : null}
            </article>
          )
        })}
      </section>
      <div className="heading-actions">
        <button className="button button-secondary" type="button" onClick={() => runUiAction(refresh())}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" /> Refresh historical state
        </button>
      </div>
    </div>
  )
}

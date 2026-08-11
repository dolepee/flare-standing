import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { StandingMandate, StandingPlan } from '../contracts'
import { formatFxrp } from '../lib/format'
import { JUDGE_DEMO, JUDGE_DEMO_REPLAY_STEPS } from '../lib/judgeDemo'
import { Status } from './Status'

type AtomicProofReplayProps = {
  mandate?: StandingMandate
  plan?: StandingPlan
  snapshotBlockNumber: bigint
  chainTimestamp: bigint
  initialized: boolean
  loading: boolean
  error?: string
  onRefresh: () => void
}

function utcTime(timestamp: bigint) {
  if (timestamp <= 0n) return 'Not scheduled'
  return `${new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(Number(timestamp) * 1_000))} UTC`
}

function currentState(
  mandate: StandingMandate | undefined,
  chainTimestamp: bigint,
  initialized: boolean,
  loading: boolean,
  error?: string,
) {
  if (!initialized && loading) return { label: 'Reading Coston2', tone: 'muted' as const }
  if (error) return { label: 'RPC unavailable', tone: 'warning' as const }
  if (!mandate) return { label: 'State not found', tone: 'warning' as const }
  if (mandate.canceled) return { label: 'Canceled', tone: 'warning' as const }
  if (mandate.remaining === 0n) return { label: 'Open · no capacity', tone: 'warning' as const }
  if (mandate.lastChargeAt > 0n && mandate.nextChargeAt > chainTimestamp) return { label: 'Paid · active', tone: 'good' as const }
  if (mandate.lastChargeAt > 0n) return { label: 'Paid window ended · charge due', tone: 'warning' as const }
  if (mandate.nextChargeAt <= chainTimestamp) return { label: 'Open · charge due', tone: 'good' as const }
  return { label: 'Open · scheduled', tone: 'good' as const }
}

export function AtomicProofReplay({
  mandate,
  plan,
  snapshotBlockNumber,
  chainTimestamp,
  initialized,
  loading,
  error,
  onRefresh,
}: AtomicProofReplayProps) {
  const [activeStepId, setActiveStepId] = useState(JUDGE_DEMO_REPLAY_STEPS[0].id)
  const activeStep = JUDGE_DEMO_REPLAY_STEPS.find((step) => step.id === activeStepId) ?? JUDGE_DEMO_REPLAY_STEPS[0]
  const state = currentState(mandate, chainTimestamp, initialized, loading, error)

  return (
    <section className="proof-replay" id="verified-replay" aria-labelledby="proof-replay-title">
      <div className="proof-replay-heading">
        <div>
          <span className="eyebrow">Verified replay · no wallet</span>
          <h2 id="proof-replay-title">Follow the real payment</h2>
        </div>
        <Status tone="good">Public proof</Status>
      </div>

      <ol className="replay-step-list" aria-label="Atomic subscription proof steps">
        {JUDGE_DEMO_REPLAY_STEPS.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              className={activeStep.id === step.id ? 'replay-step active' : 'replay-step'}
              aria-pressed={activeStep.id === step.id}
              aria-controls="atomic-replay-detail"
              onClick={() => setActiveStepId(step.id)}
            >
              <span>{step.index}</span>
              <strong>{step.shortLabel}</strong>
            </button>
          </li>
        ))}
      </ol>

      <div className="replay-detail" id="atomic-replay-detail" aria-live="polite">
        <span>{activeStep.network}</span>
        <h3>{activeStep.title}</h3>
        <p>{activeStep.summary}</p>
        <div className="replay-result"><CheckCircle2 size={16} aria-hidden="true" /> {activeStep.result}</div>
        <code title={activeStep.transaction}>{activeStep.transaction}</code>
        <a href={activeStep.href} target="_blank" rel="noreferrer">
          {activeStep.linkLabel} <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>

      <div className="replay-current" aria-labelledby="replay-current-title">
        <div className="replay-current-heading">
          <div>
            <span className="eyebrow">Block-pinned durable showcase</span>
            <h3 id="replay-current-title">Mandate 2 paid through judging</h3>
          </div>
          <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh mandate 2 from Coston2">
            <RefreshCw size={16} className={loading ? 'spin' : ''} aria-hidden="true" />
          </button>
        </div>
        <dl>
          <div><dt>Recurring state</dt><dd><Status tone={state.tone}>{state.label}</Status></dd></div>
          <div><dt>Capacity left</dt><dd>{mandate ? `${formatFxrp(mandate.remaining, 6)} of ${formatFxrp(mandate.deposited, 6)} FTestXRP` : '—'}</dd></div>
          <div><dt>Last charged</dt><dd>{mandate?.lastChargeAt ? utcTime(mandate.lastChargeAt) : 'Not yet'}</dd></div>
          <div><dt>Next charge</dt><dd>{mandate ? utcTime(mandate.nextChargeAt) : '—'}</dd></div>
          <div><dt>Subscriber</dt><dd title={JUDGE_DEMO.subscriber}>{mandate?.subscriber ?? JUDGE_DEMO.subscriber}</dd></div>
          <div><dt>Plan</dt><dd>#{JUDGE_DEMO.planId.toString()} · {plan?.active ? 'renewals enabled' : initialized ? 'future renewals paused' : 'checking'}</dd></div>
          <div><dt>Snapshot block</dt><dd>{snapshotBlockNumber > 0n ? `#${snapshotBlockNumber.toLocaleString('en-US')}` : '—'}</dd></div>
        </dl>
        <p>{error ? 'The recorded receipts remain independently inspectable while the durable-state read is unavailable.' : 'Every value above was read at the same public Coston2 block. The fast replay above is historical; this separate mandate keeps the result paid through 25 Aug 2026.'}</p>
        <div className="replay-current-links">
          <Link className="text-link" to="/demo">Open mandate-gated brief</Link>
          <a className="text-link" href={JUDGE_DEMO.coston2Href} target="_blank" rel="noreferrer">Inspect durable activation <ExternalLink size={14} aria-hidden="true" /></a>
        </div>
      </div>
    </section>
  )
}

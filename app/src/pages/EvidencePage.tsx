import { CheckCircle2, ExternalLink } from 'lucide-react'
import { COSTON2_EXPLORER, FTSO_ADAPTER_ADDRESS, STANDING_ADDRESS } from '../config'

const proofRows = [
  { label: 'Hardened Standing deployment', network: 'Coston2', value: STANDING_ADDRESS, href: `${COSTON2_EXPLORER}/address/${STANDING_ADDRESS}` },
  { label: 'FTSO USD adapter', network: 'Coston2', value: FTSO_ADAPTER_ADDRESS, href: `${COSTON2_EXPLORER}/address/${FTSO_ADAPTER_ADDRESS}` },
  { label: 'Atomic XRP subscription payment', network: 'XRPL Testnet', value: '09BFC17FE831A80069362F34F56EC98B348787A143EA46C313811DC3E178729A', href: 'https://testnet.xrpl.org/transactions/09BFC17FE831A80069362F34F56EC98B348787A143EA46C313811DC3E178729A' },
  { label: 'Atomic FXRP mint + mandate 5', network: 'Coston2', value: '0x712d68f0a2672123fdc2b18bef1df6eb85d0539b00dc3011c5321aa8342b9064', href: `${COSTON2_EXPLORER}/tx/0x712d68f0a2672123fdc2b18bef1df6eb85d0539b00dc3011c5321aa8342b9064` },
  { label: 'Live USD-priced charge', network: 'Coston2', value: '0x0791f6fd41dc4a5cf94e9a4973ecba3ed8c3b3e82b3169d1f214f2bc8fb28a43', href: `${COSTON2_EXPLORER}/tx/0x0791f6fd41dc4a5cf94e9a4973ecba3ed8c3b3e82b3169d1f214f2bc8fb28a43` },
  { label: 'Tagged direct-mint execution', network: 'Coston2', value: '0x740995f3602e9f6548ccb11d70c789c53490faee67d1455f2a6faa7e3bec4c28', href: `${COSTON2_EXPLORER}/tx/0x740995f3602e9f6548ccb11d70c789c53490faee67d1455f2a6faa7e3bec4c28` },
]

const pilotRows = [
  { label: 'Virtual creates plan 4', detail: 'External merchant', value: '0xdd9362d5794493e94f7ec26c1ff4b40ba4e545bbc707465a31bb8a3c60382924' },
  { label: 'Subscriber opens mandate 4', detail: '1 FTestXRP prepaid', value: '0x1a350e64894b74bd0569249cefae30bffbae26b6b97bbdb111eb92c86e7aa891' },
  { label: 'Scheduled FTSO charge', detail: '0.092905 FTestXRP', value: '0x0b645b0c6bc4d8e510b84303cb879f2d945c3480358405bba3c9df8f7297aef7' },
  { label: 'Subscriber cancels', detail: 'Later charges blocked', value: '0x09bf4c1c0291edb076b003c6a023f1f07671e627bad7a6dbd048efc5ed40732b' },
  { label: 'Unused capacity returned', detail: '0.907095 FTestXRP', value: '0x1766be15d3e344a63cb238de339a7b2ef259932c288aac4b0cbefabfc892052f' },
  { label: 'Virtual claims accrual', detail: '0.091976 FTestXRP', value: '0xb1f66ae4984b278c3d01dc58c389339fb80c2e3d22d6caf32acd346b34fe5e0c' },
]

export function EvidencePage() {
  return (
    <div className="page">
      <section className="page-heading"><div><span className="eyebrow">Public verification</span><h1>One XRP payment. One live mandate.</h1><p>The atomic subscription, FTSO conversion, and external pilot lifecycle can be replayed from public XRPL Testnet and Coston2 state. Participant attribution is separately attested.</p></div></section>
      <section className="proof-layout">
        <div className="proof-list">
          {proofRows.map((proof) => (
            <a key={proof.label} href={proof.href} target="_blank" rel="noreferrer">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div><strong>{proof.label}</strong><span>{proof.network} · {proof.value.slice(0, 10)}...{proof.value.slice(-6)}</span></div>
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          ))}
        </div>
        <aside className="mint-timeline">
          <span className="eyebrow">XRPL → Flare</span><h2>Atomic subscribe</h2>
          <ol>
            <li><span>1.2 XRP</span><div><strong>Payment validated</strong><small>42-byte 0xFE Smart Account memo</small></div></li>
            <li><span>FDC</span><div><strong>Payment proven on Flare</strong><small>1 FXRP minted to the derived account</small></div></li>
            <li><span>Mandate 5</span><div><strong>Subscription opened atomically</strong><small>Plan 4 · 1 FXRP prepaid capacity</small></div></li>
          </ol>
          <p>Controlled-builder testnet evidence using Flare Smart Accounts, FAssets, FDC, and Standing. This is not a mainnet or customer-adoption claim.</p>
        </aside>
      </section>
      <section className="pilot-evidence" aria-labelledby="pilot-evidence-title">
        <div className="pilot-copy">
          <span className="eyebrow">Controlled external pilot</span>
          <h2 id="pilot-evidence-title">Separate merchant and subscriber wallets completed the loop.</h2>
          <p>Virtual created a USD-priced plan. An anonymous independent subscriber prepaid one test FXRP. The permissionless keeper path charged the due mandate, Virtual withdrew the merchant accrual, and the subscriber canceled and recovered the exact unused capacity.</p>
          <dl className="pilot-facts">
            <div><dt>Charged</dt><dd>0.092905 FTestXRP</dd></div>
            <div><dt>Merchant</dt><dd>0.091976 FTestXRP</dd></div>
            <div><dt>Fee</dt><dd>0.000929 FTestXRP</dd></div>
          </dl>
          <blockquote>“Standing made the recurring Coston2 payment lifecycle easy to verify from plan creation through merchant withdrawal.”<cite>Virtual</cite></blockquote>
          <p className="pilot-boundary">Chain state proves the addresses and lifecycle, not who controls those wallets. Virtual attribution, subscriber independence, and the quote are participant attestations. This controlled Coston2 pilot is not production adoption, recurring revenue, a mainnet customer, a partnership, or an end-to-end browser-wallet UX claim.</p>
        </div>
        <div className="pilot-proof-list" aria-label="External pilot transactions">
          {pilotRows.map((proof) => (
            <a key={proof.label} href={`${COSTON2_EXPLORER}/tx/${proof.value}`} target="_blank" rel="noreferrer">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div><strong>{proof.label}</strong><span>{proof.detail} · {proof.value.slice(0, 10)}...{proof.value.slice(-6)}</span></div>
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}

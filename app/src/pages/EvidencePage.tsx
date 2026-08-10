import { CheckCircle2, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { COSTON2_EXPLORER, FTSO_ADAPTER_ADDRESS, STANDING_ADDRESS } from '../config'
import { ATOMIC_PROOF } from '../lib/atomicProof'

const proofRows = [
  { label: 'Standing V2 deployment', network: 'Flare Coston2 testnet', value: ATOMIC_PROOF.deployTransaction, href: ATOMIC_PROOF.deployHref },
  { label: 'Atomic XRP Access plan created', network: 'Flare Coston2 testnet', value: ATOMIC_PROOF.planTransaction, href: ATOMIC_PROOF.planHref },
  { label: 'Standing V2 contract', network: 'Flare Coston2 testnet', value: STANDING_ADDRESS, href: `${COSTON2_EXPLORER}/address/${STANDING_ADDRESS}` },
  { label: 'FTSO USD adapter', network: 'Flare Coston2 testnet', value: FTSO_ADAPTER_ADDRESS, href: `${COSTON2_EXPLORER}/address/${FTSO_ADAPTER_ADDRESS}` },
  { label: 'User-authorized XRP payment', network: 'XRPL Testnet', value: ATOMIC_PROOF.xrplTransaction, href: ATOMIC_PROOF.xrplHref },
  { label: 'Direct mint + open + first charge', network: 'Flare Coston2 testnet', value: ATOMIC_PROOF.coston2Transaction, href: ATOMIC_PROOF.coston2Href },
  { label: 'Permissionless recurring keeper charge', network: 'Flare Coston2 testnet', value: ATOMIC_PROOF.chargeTransaction, href: ATOMIC_PROOF.chargeHref },
]

const pilotRows = [
  { label: 'Plan 4 created', detail: 'Merchant wallet later attributed to Virtual', value: '0xdd9362d5794493e94f7ec26c1ff4b40ba4e545bbc707465a31bb8a3c60382924' },
  { label: 'Subscriber address opens mandate 4', detail: '1 FTestXRP prepaid', value: '0x1a350e64894b74bd0569249cefae30bffbae26b6b97bbdb111eb92c86e7aa891' },
  { label: 'Scheduled FTSO charge', detail: '0.092905 FTestXRP', value: '0x0b645b0c6bc4d8e510b84303cb879f2d945c3480358405bba3c9df8f7297aef7' },
  { label: 'Subscriber address cancels', detail: 'Later charges blocked', value: '0x09bf4c1c0291edb076b003c6a023f1f07671e627bad7a6dbd048efc5ed40732b' },
  { label: 'Unused capacity returned', detail: '0.907095 FTestXRP', value: '0x1766be15d3e344a63cb238de339a7b2ef259932c288aac4b0cbefabfc892052f' },
  { label: 'Merchant wallet claims accrual', detail: '0.091976 FTestXRP', value: '0xb1f66ae4984b278c3d01dc58c389339fb80c2e3d22d6caf32acd346b34fe5e0c' },
]

export function EvidencePage() {
  return (
    <div className="page evidence-page">
      <section className="page-heading evidence-heading">
        <div>
          <span className="eyebrow">Exact public receipts · testnets only</span>
          <h1>Inspect every proof at its source.</h1>
          <p>The primary claim is narrow: one validated XRPL Testnet payment and one successful Coston2 transaction direct-minted FTestXRP, opened mandate 1, and paid its first cycle. Identity statements stay separate from what chain state proves.</p>
        </div>
        <Link className="button button-primary" to="/#verified-replay">Open interactive replay</Link>
      </section>

      <section className="receipt-boundary" aria-label="Proof and checkout boundary">
        <div><strong>Verified XRP path</strong><span>Fresh public V2 receipts plus the latest read of mandate 1. No wallet or writes.</span></div>
        <div><strong>Live browser checkout</strong><span>A separate Coston2 testnet path uses existing FTestXRP to open and charge atomically.</span></div>
      </section>

      <section className="proof-layout">
        <div className="proof-list" aria-label="Primary public proof links">
          {proofRows.map((proof) => (
            <a key={proof.label} href={proof.href} target="_blank" rel="noreferrer">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div><strong>{proof.label}</strong><span>{proof.network}</span><code>{proof.value}</code></div>
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          ))}
        </div>
        <aside className="mint-timeline">
          <span className="eyebrow">Verified XRPL → Flare path</span><h2>One payment, one atomic result</h2>
          <ol>
            <li><span>1.2 XRP</span><div><strong>Payment validated</strong><small>tesSUCCESS · ledger {ATOMIC_PROOF.xrplLedger} · canonical 0xFE instruction</small></div></li>
            <li><span>FDC</span><div><strong>Payment proven on Coston2</strong><small>1.1 FTestXRP reached the Smart Account; 1 FTestXRP entered Standing</small></div></li>
            <li><span>#1</span><div><strong>The mandate opens</strong><small>Plan 1 · 1 FTestXRP deposited · subscriber remains in control</small></div></li>
            <li><span>Paid</span><div><strong>First-cycle access activates immediately</strong><small>0.1 charged · 0.099 merchant · 0.001 fee · 0.9 remains</small></div></li>
            <li><span>Keeper</span><div><strong>The next cycle advances permissionlessly</strong><small>Different sender · 0.1 charged · 0.8 remains · no subscriber key</small></div></li>
          </ol>
          <p>Controlled-builder evidence using XRPL Testnet, Flare Coston2, Smart Accounts, FAssets, FDC, and Standing. The XRPL payment and Coston2 execution are separate source-chain transactions. This is not a mainnet or customer-adoption claim.</p>
        </aside>
      </section>

      <section className="pilot-evidence" aria-labelledby="pilot-evidence-title">
        <div className="pilot-copy">
          <span className="eyebrow">Secondary lifecycle · participant-attested</span>
          <h2 id="pilot-evidence-title">Separate addresses completed a Coston2 billing loop.</h2>
          <p>A merchant address created a USD-priced plan, a separate subscriber address prepaid one FTestXRP, the keeper path charged it, and the two addresses later claimed or recovered their balances. The participant attributed the merchant wallet to Virtual; chain state does not prove that identity.</p>
          <dl className="pilot-facts">
            <div><dt>Charged</dt><dd>0.092905 FTestXRP</dd></div>
            <div><dt>Merchant</dt><dd>0.091976 FTestXRP</dd></div>
            <div><dt>Fee</dt><dd>0.000929 FTestXRP</dd></div>
          </dl>
          <blockquote>“Standing made the recurring Coston2 payment lifecycle easy to verify from plan creation through merchant withdrawal.”<cite>Participant-provided quote · Virtual</cite></blockquote>
          <p className="pilot-boundary">The receipts prove addresses and state transitions. Virtual attribution, participant independence, and the quote are attestations. This controlled Coston2 pilot is not production adoption, recurring revenue, a mainnet customer, a partnership, or an end-to-end browser-wallet UX claim.</p>
        </div>
        <div className="pilot-proof-list" aria-label="Participant-attested pilot transactions">
          {pilotRows.map((proof) => (
            <a key={proof.label} href={`${COSTON2_EXPLORER}/tx/${proof.value}`} target="_blank" rel="noreferrer">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div><strong>{proof.label}</strong><span>{proof.detail}</span><code>{proof.value}</code></div>
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}

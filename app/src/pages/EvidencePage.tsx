import { CheckCircle2, ExternalLink } from 'lucide-react'
import { COSTON2_EXPLORER, FTSO_ADAPTER_ADDRESS, STANDING_ADDRESS } from '../config'

const proofRows = [
  { label: 'Hardened Standing deployment', network: 'Coston2', value: STANDING_ADDRESS, href: `${COSTON2_EXPLORER}/address/${STANDING_ADDRESS}` },
  { label: 'FTSO USD adapter', network: 'Coston2', value: FTSO_ADAPTER_ADDRESS, href: `${COSTON2_EXPLORER}/address/${FTSO_ADAPTER_ADDRESS}` },
  { label: 'Live USD-priced charge', network: 'Coston2', value: '0x0791f6fd41dc4a5cf94e9a4973ecba3ed8c3b3e82b3169d1f214f2bc8fb28a43', href: `${COSTON2_EXPLORER}/tx/0x0791f6fd41dc4a5cf94e9a4973ecba3ed8c3b3e82b3169d1f214f2bc8fb28a43` },
  { label: 'Tagged direct-mint execution', network: 'Coston2', value: '0x740995f3602e9f6548ccb11d70c789c53490faee67d1455f2a6faa7e3bec4c28', href: `${COSTON2_EXPLORER}/tx/0x740995f3602e9f6548ccb11d70c789c53490faee67d1455f2a6faa7e3bec4c28` },
]

export function EvidencePage() {
  return (
    <div className="page">
      <section className="page-heading"><div><span className="eyebrow">Public verification</span><h1>The rails are testnet-live.</h1><p>Every protocol claim below resolves to public chain state. External-user validation remains a separate, unfinished gate.</p></div></section>
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
          <span className="eyebrow">XRPL → Flare</span><h2>Direct mint</h2>
          <ol>
            <li><span>19:06:20</span><div><strong>XRPL payment validated</strong><small>10.2 XRP · tag 182</small></div></li>
            <li><span>+153s</span><div><strong>FXRP minted</strong><small>10 FXRP to derived smart account</small></div></li>
            <li><span>Complete</span><div><strong>Publicly reproducible</strong><small>Official Flare starter, unchanged</small></div></li>
          </ol>
          <p>Controlled-builder Testnet evidence. This is not a mainnet or customer-adoption claim.</p>
        </aside>
      </section>
    </div>
  )
}


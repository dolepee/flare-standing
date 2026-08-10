import { ExternalLink, Fuel, WalletCards } from 'lucide-react'
import { useId } from 'react'

export const COSTON2_FAUCET = 'https://faucet.flare.network/'
export const COSTON2_NETWORK_GUIDE = 'https://dev.flare.network/network/overview'

export function Coston2Setup() {
  const titleId = useId()

  return (
    <section className="testnet-setup" aria-labelledby={titleId}>
      <div className="testnet-setup-copy">
        <span className="eyebrow">Separate browser path · V2 deploy pending</span>
        <h2 id={titleId}>Prepare Coston2 before checkout</h2>
        <p>The V2 flow uses test assets already on Flare and will open plus charge atomically. The configured address remains V1, so no checkout write is enabled yet.</p>
      </div>
      <ol>
        <li><WalletCards size={17} aria-hidden="true" /><span><strong>Add Coston2 testnet</strong>Chain 114 in an EVM wallet</span></li>
        <li><Fuel size={17} aria-hidden="true" /><span><strong>Get free test assets</strong>C2FLR gas and FTestXRP</span></li>
        <li><span className="setup-step" aria-hidden="true">3</span><span><strong>Open + charge on V2</strong>Approval, then one atomic transaction</span></li>
      </ol>
      <div className="testnet-setup-actions">
        <a className="button button-primary" href={COSTON2_FAUCET} target="_blank" rel="noreferrer">
          Open official faucet <ExternalLink size={14} aria-hidden="true" />
        </a>
        <a className="button button-secondary" href={COSTON2_NETWORK_GUIDE} target="_blank" rel="noreferrer">
          Network details <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

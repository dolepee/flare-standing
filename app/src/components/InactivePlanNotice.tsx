import { Archive, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export function InactivePlanNotice({ planId, planName, historicalProof = false }: { planId: bigint; planName: string; historicalProof?: boolean }) {
  if (!historicalProof) {
    return (
      <section className="route-failure inactive-plan-notice" role="status" aria-live="polite">
        <Archive aria-hidden="true" />
        <span className="eyebrow">Checkout paused</span>
        <h1>{planName} is not accepting new mandates.</h1>
        <p>Plan #{planId.toString()} is currently inactive on Coston2. Its merchant may reactivate it later; no wallet connection or transaction is available while it is paused.</p>
        <div className="inactive-plan-actions">
          <Link className="button button-primary" to="/plans">View active plans <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      </section>
    )
  }

  return (
    <section className="route-failure inactive-plan-notice" role="status" aria-live="polite">
      <Archive aria-hidden="true" />
      <span className="eyebrow">Historical checkout retired</span>
      <h1>{planName} is paused.</h1>
      <p>
        Plan #{planId.toString()} is retained only as public evidence of its completed atomic first charge and later permissionless renewal. It cannot accept new mandates or continue scheduled charges.
      </p>
      <div className="inactive-plan-actions">
        <Link className="button button-primary" to="/demo">Open the durable live demo <ArrowRight size={15} aria-hidden="true" /></Link>
        <Link className="button button-secondary" to="/evidence">Verify historical receipts</Link>
      </div>
      <small>No wallet connection or transaction is required on this retired path.</small>
    </section>
  )
}

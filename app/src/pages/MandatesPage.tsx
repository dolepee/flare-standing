import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MandateRow } from '../components/MandateRow'
import { useProtocol } from '../context/ProtocolContext'
import { useWallet } from '../context/WalletContext'
import { isSameAddress } from '../lib/format'

export function MandatesPage() {
  const { account } = useWallet()
  const { state } = useProtocol()
  const [view, setView] = useState<'mine' | 'all'>('mine')
  const mandates = useMemo(
    () => view === 'all' ? state.mandates : state.mandates.filter((mandate) => isSameAddress(account, mandate.subscriber)),
    [account, state.mandates, view],
  )

  return (
    <div className="page">
      <section className="page-heading split-heading">
        <div><span className="eyebrow">Current V2 · Coston2 testnet controls</span><h1>Testnet mandates</h1><p>Manage current V2 mandates here. Retired V1 balances use a separate, restricted recovery route.</p></div>
        <div className="heading-actions">
          <Link className="button button-secondary" to="/legacy-recovery">Historical V1 recovery</Link>
          <div className="segmented" role="group" aria-label="Mandate view">
            <button type="button" className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>My mandates</button>
            <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All activity</button>
          </div>
        </div>
      </section>
      <section className="mandate-grid">
        {mandates.length ? mandates.map((mandate) => (
          <MandateRow key={mandate.id.toString()} mandate={mandate} plan={state.plans.find((plan) => plan.id === mandate.planId)} />
        )) : <div className="empty-state large-empty">{account ? 'No mandates in this view.' : 'Connect a wallet to see your mandates.'}</div>}
      </section>
    </div>
  )
}

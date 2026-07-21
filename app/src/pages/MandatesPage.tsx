import { useMemo, useState } from 'react'
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
        <div><span className="eyebrow">Payment controls</span><h1>Mandates</h1><p>Top up, charge, cancel, or recover unused FXRP from one place.</p></div>
        <div className="segmented" role="group" aria-label="Mandate view">
          <button type="button" className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>My mandates</button>
          <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All activity</button>
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


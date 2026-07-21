import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PlanRow } from '../components/PlanRow'
import { useProtocol } from '../context/ProtocolContext'

export function PlansPage() {
  const { state, loading } = useProtocol()
  const [query, setQuery] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const plans = useMemo(
    () => state.plans.filter((plan) => {
      const matches = `${plan.id} ${plan.merchant}`.toLowerCase().includes(query.toLowerCase())
      return matches && (!activeOnly || plan.active)
    }),
    [activeOnly, query, state.plans],
  )

  return (
    <div className="page">
      <section className="page-heading">
        <div><span className="eyebrow">Plan directory</span><h1>Choose a recurring payment.</h1><p>Every plan is merchant-owned. Your prepaid mandate remains cancelable by your wallet.</p></div>
      </section>
      <div className="filterbar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search plans</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plan or merchant" />
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} />
          <span aria-hidden="true" /> Active only
        </label>
      </div>
      <section className="list-surface" aria-busy={loading}>
        <div className="list-header"><span>Plan</span><span>Price and merchant</span><span>Action</span></div>
        {plans.length ? plans.map((plan) => <PlanRow key={plan.id.toString()} plan={plan} />) : <div className="empty-state">No plans match this filter.</div>}
      </section>
    </div>
  )
}


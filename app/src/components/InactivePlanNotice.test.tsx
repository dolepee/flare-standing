import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { InactivePlanNotice } from './InactivePlanNotice'

afterEach(cleanup)

describe('InactivePlanNotice', () => {
  it('routes a retired checkout to the durable result without asking for a wallet', () => {
    render(
      <MemoryRouter>
        <InactivePlanNotice planId={1n} planName="Fast-Cadence XRP Proof" historicalProof />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Fast-Cadence XRP Proof is paused.' })).toBeInTheDocument()
    expect(screen.getByText(/cannot accept new mandates or continue scheduled charges/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the durable live demo/ })).toHaveAttribute('href', '/demo')
    expect(screen.getByRole('link', { name: 'Verify historical receipts' })).toHaveAttribute('href', '/evidence')
    expect(screen.queryByRole('button', { name: /Connect|Open|Charge/i })).not.toBeInTheDocument()
  })

  it('does not attribute historical receipts to an arbitrary paused plan', () => {
    render(
      <MemoryRouter>
        <InactivePlanNotice planId={7n} planName="Merchant Plan" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Merchant Plan is not accepting new mandates.' })).toBeInTheDocument()
    expect(screen.getByText(/merchant may reactivate it later/i)).toBeInTheDocument()
    expect(screen.queryByText(/permissionless renewal/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Verify historical receipts' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View active plans/ })).toHaveAttribute('href', '/plans')
  })
})

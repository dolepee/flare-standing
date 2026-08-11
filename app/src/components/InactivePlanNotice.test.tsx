import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InactivePlanNotice } from './InactivePlanNotice'

describe('InactivePlanNotice', () => {
  it('routes a retired checkout to the durable result without asking for a wallet', () => {
    render(
      <MemoryRouter>
        <InactivePlanNotice planId={1n} planName="Fast-Cadence XRP Proof" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Fast-Cadence XRP Proof is paused.' })).toBeInTheDocument()
    expect(screen.getByText(/cannot accept new mandates or continue scheduled charges/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the durable live demo/ })).toHaveAttribute('href', '/demo')
    expect(screen.getByRole('link', { name: 'Verify historical receipts' })).toHaveAttribute('href', '/evidence')
    expect(screen.queryByRole('button', { name: /Connect|Open|Charge/i })).not.toBeInTheDocument()
  })
})

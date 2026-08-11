import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRouteMetadata } from '../lib/routeMetadata'
import { RouteMetadata } from './RouteMetadata'

function RouteHarness() {
  const navigate = useNavigate()
  return (
    <>
      <RouteMetadata />
      <button type="button" onClick={() => navigate('/demo')}>Demo</button>
      <button type="button" onClick={() => navigate('/evidence')}>Evidence</button>
    </>
  )
}

function headValue(selector: string, attribute: string) {
  return document.head.querySelector(selector)?.getAttribute(attribute)
}

describe('RouteMetadata', () => {
  const originalHead = document.head.innerHTML

  beforeEach(() => {
    document.head.innerHTML = `${originalHead}
      <link rel="canonical" href="https://duplicate.invalid/">
      <link rel="canonical" href="https://duplicate-two.invalid/">
      <meta property="og:url" content="https://duplicate.invalid/">
      <meta property="og:url" content="https://duplicate-two.invalid/">`
  })

  afterEach(() => {
    document.head.innerHTML = originalHead
  })

  it('keeps one canonical and Open Graph URL while route metadata changes', async () => {
    const view = render(
      <MemoryRouter initialEntries={['/']}>
        <RouteHarness />
      </MemoryRouter>,
    )

    await waitFor(() => expect(document.title).toBe('Standing | Pay in XRP, land subscribed on Flare'))
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('meta[property="og:url"]')).toHaveLength(1)
    expect(headValue('link[rel="canonical"]', 'href')).toBe('https://standing.dolepee.com/')
    expect(headValue('meta[property="og:url"]', 'content')).toBe('https://standing.dolepee.com/')

    fireEvent.click(view.getByRole('button', { name: 'Demo' }))
    await waitFor(() => expect(document.title).toBe('Wallet-Free XRP Subscription Demo | Standing'))
    expect(headValue('meta[name="description"]', 'content')).toBe('Inspect the useful subscriber brief unlocked by one verified XRP payment and its bounded recurring mandate on Flare Coston2.')
    expect(headValue('meta[property="og:title"]', 'content')).toBe(document.title)
    expect(headValue('meta[property="og:description"]', 'content')).toBe(headValue('meta[name="description"]', 'content'))
    expect(headValue('link[rel="canonical"]', 'href')).toBe('https://standing.dolepee.com/demo')
    expect(headValue('meta[property="og:url"]', 'content')).toBe('https://standing.dolepee.com/demo')
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('meta[property="og:url"]')).toHaveLength(1)

    fireEvent.click(view.getByRole('button', { name: 'Evidence' }))
    await waitFor(() => expect(document.title).toBe('Verified XRP-to-Flare Receipts | Standing'))
    expect(headValue('meta[name="description"]', 'content')).toBe('Verify Standing’s XRPL Testnet payment and Coston2 plan, activation, recurring charge, and merchant-withdrawal receipts at their sources.')
    expect(headValue('link[rel="canonical"]', 'href')).toBe('https://standing.dolepee.com/evidence')
    expect(headValue('meta[property="og:url"]', 'content')).toBe('https://standing.dolepee.com/evidence')
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('meta[property="og:url"]')).toHaveLength(1)
  })

  it('normalizes stable routes and uses a deterministic safe fallback', () => {
    expect(resolveRouteMetadata('/demo/')).toEqual(resolveRouteMetadata('/demo'))
    expect(resolveRouteMetadata('/Demo')).toEqual(resolveRouteMetadata('/demo'))
    expect(resolveRouteMetadata('/EVIDENCE')).toEqual(resolveRouteMetadata('/evidence'))
    expect(resolveRouteMetadata('/Checkout/42').canonicalUrl).toBe('https://standing.dolepee.com/checkout/42')
    expect(resolveRouteMetadata('/ACCESS/7').canonicalUrl).toBe('https://standing.dolepee.com/access/7')
    expect(resolveRouteMetadata('/checkout/%2e%2e').canonicalUrl).toBe('https://standing.dolepee.com/')
    expect(resolveRouteMetadata('/access/%2Fmerchant').canonicalUrl).toBe('https://standing.dolepee.com/')
    expect(resolveRouteMetadata('/unknown-route')).toEqual({
      title: 'Page Not Found | Standing',
      description: 'The requested Standing page was not found. Return to the verified XRP-to-Flare subscription experience.',
      canonicalUrl: 'https://standing.dolepee.com/',
    })
  })
})

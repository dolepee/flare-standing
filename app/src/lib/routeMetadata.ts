const SITE_ORIGIN = 'https://standing.dolepee.com'

export interface RouteMetadata {
  title: string
  description: string
  canonicalUrl: string
}

const HOME_METADATA: RouteMetadata = {
  title: 'Standing | Pay in XRP, land subscribed on Flare',
  description: 'Standing V2 on Coston2 testnet turns one verified XRP payment into an immediately paid, subscriber-controlled recurring mandate on Flare.',
  canonicalUrl: `${SITE_ORIGIN}/`,
}

const ROUTE_METADATA = new Map<string, Omit<RouteMetadata, 'canonicalUrl'>>([
  ['/', {
    title: HOME_METADATA.title,
    description: HOME_METADATA.description,
  }],
  ['/demo', {
    title: 'Wallet-Free XRP Subscription Demo | Standing',
    description: 'Inspect the useful subscriber brief unlocked by one verified XRP payment and its bounded recurring mandate on Flare Coston2.',
  }],
  ['/evidence', {
    title: 'Verified XRP-to-Flare Receipts | Standing',
    description: 'Verify Standing’s XRPL Testnet payment and Coston2 plan, activation, recurring charge, and merchant-withdrawal receipts at their sources.',
  }],
  ['/plans', {
    title: 'Coston2 Testnet Checkout | Standing',
    description: 'Explore Standing’s fixed-price Coston2 test plans and open a subscriber-controlled recurring mandate.',
  }],
  ['/mandates', {
    title: 'Subscriber Mandates | Standing',
    description: 'Inspect and control Standing recurring mandates owned by the connected subscriber on Flare Coston2.',
  }],
  ['/merchant', {
    title: 'Merchant Testnet Tools | Standing',
    description: 'Use Standing’s Coston2 merchant tools to create fixed-price plans and withdraw earned recurring payments.',
  }],
  ['/legacy-recovery', {
    title: 'Historical V1 Recovery | Standing',
    description: 'Inspect and recover eligible historical Standing V1 mandate balances without reopening legacy subscriptions.',
  }],
])

function normalizePathname(pathname: string) {
  const normalized = `/${pathname}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return normalized || '/'
}

export function resolveRouteMetadata(pathname: string): RouteMetadata {
  const normalizedPath = normalizePathname(pathname)
  const exact = ROUTE_METADATA.get(normalizedPath)
  if (exact) {
    return {
      ...exact,
      canonicalUrl: `${SITE_ORIGIN}${normalizedPath === '/' ? '/' : normalizedPath}`,
    }
  }

  if (/^\/checkout\/[^/]+$/.test(normalizedPath)) {
    return {
      title: 'Coston2 Testnet Checkout | Standing',
      description: 'Review a Standing test plan and open a subscriber-controlled recurring mandate on Flare Coston2.',
      canonicalUrl: `${SITE_ORIGIN}${normalizedPath}`,
    }
  }

  if (/^\/access\/[^/]+$/.test(normalizedPath)) {
    return {
      title: 'Subscriber Access | Standing',
      description: 'Open the useful subscriber artifact unlocked by a paid Standing recurring mandate on Flare Coston2.',
      canonicalUrl: `${SITE_ORIGIN}${normalizedPath}`,
    }
  }

  return {
    title: 'Page Not Found | Standing',
    description: 'The requested Standing page was not found. Return to the verified XRP-to-Flare subscription experience.',
    canonicalUrl: HOME_METADATA.canonicalUrl,
  }
}

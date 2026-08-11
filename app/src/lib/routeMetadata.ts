import routeManifest from '../../route-metadata.json'

export interface RouteMetadata {
  title: string
  description: string
  canonicalUrl: string
}

const ROUTE_METADATA = new Map(routeManifest.stableRoutes.map((route) => [route.path, route]))

function normalizePathname(pathname: string) {
  const normalized = `/${pathname}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return normalized || '/'
}

export function resolveRouteMetadata(pathname: string): RouteMetadata {
  const normalizedPath = normalizePathname(pathname)
  const exact = ROUTE_METADATA.get(normalizedPath.toLowerCase())
  if (exact) {
    return {
      title: exact.title,
      description: exact.description,
      canonicalUrl: `${routeManifest.siteOrigin}${exact.path}`,
    }
  }

  const checkout = normalizedPath.match(/^\/checkout\/([1-9]\d*)$/i)
  if (checkout) {
    return {
      title: 'Coston2 Testnet Checkout | Standing',
      description: 'Review a Standing test plan and open a subscriber-controlled recurring mandate on Flare Coston2.',
      canonicalUrl: `${routeManifest.siteOrigin}/checkout/${checkout[1]}`,
    }
  }

  const access = normalizedPath.match(/^\/access\/([1-9]\d*)$/i)
  if (access) {
    return {
      title: 'Subscriber Access | Standing',
      description: 'Open the useful subscriber artifact unlocked by a paid Standing recurring mandate on Flare Coston2.',
      canonicalUrl: `${routeManifest.siteOrigin}/access/${access[1]}`,
    }
  }

  return {
    title: routeManifest.fallback.title,
    description: routeManifest.fallback.description,
    canonicalUrl: `${routeManifest.siteOrigin}${routeManifest.fallback.canonicalPath}`,
  }
}

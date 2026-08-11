import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { resolveRouteMetadata } from '../lib/routeMetadata'

function setSingletonAttribute(
  selector: string,
  create: () => HTMLElement,
  attribute: string,
  value: string,
) {
  const matches = [...document.head.querySelectorAll<HTMLElement>(selector)]
  const element = matches.shift() ?? create()
  for (const duplicate of matches) duplicate.remove()
  element.setAttribute(attribute, value)
}

function createMeta(attribute: 'name' | 'property', value: string) {
  const element = document.createElement('meta')
  element.setAttribute(attribute, value)
  document.head.append(element)
  return element
}

function applyRouteMetadata(pathname: string) {
  const metadata = resolveRouteMetadata(pathname)

  document.title = metadata.title
  setSingletonAttribute('meta[name="description"]', () => createMeta('name', 'description'), 'content', metadata.description)
  setSingletonAttribute('link[rel="canonical"]', () => {
    const element = document.createElement('link')
    element.setAttribute('rel', 'canonical')
    document.head.append(element)
    return element
  }, 'href', metadata.canonicalUrl)
  setSingletonAttribute('meta[property="og:title"]', () => createMeta('property', 'og:title'), 'content', metadata.title)
  setSingletonAttribute('meta[property="og:description"]', () => createMeta('property', 'og:description'), 'content', metadata.description)
  setSingletonAttribute('meta[property="og:url"]', () => createMeta('property', 'og:url'), 'content', metadata.canonicalUrl)
  setSingletonAttribute('meta[name="twitter:title"]', () => createMeta('name', 'twitter:title'), 'content', metadata.title)
  setSingletonAttribute('meta[name="twitter:description"]', () => createMeta('name', 'twitter:description'), 'content', metadata.description)
}

export function RouteMetadata() {
  const { pathname } = useLocation()

  useEffect(() => {
    applyRouteMetadata(pathname)
  }, [pathname])

  return null
}

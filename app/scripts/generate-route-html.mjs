import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MANIFEST_URL = new URL('../route-metadata.json', import.meta.url)

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function replaceSingleton(html, pattern, replacement, label) {
  const matches = [...html.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} in the app shell, found ${matches.length}`)
  }
  return html.replace(pattern, replacement)
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Route metadata manifest must be an object')
  if (typeof manifest.siteOrigin !== 'string' || !/^https:\/\/[^/]+$/.test(manifest.siteOrigin)) {
    throw new Error('Route metadata siteOrigin must be an HTTPS origin without a trailing slash')
  }
  if (!manifest.fallback || typeof manifest.fallback.title !== 'string' || typeof manifest.fallback.description !== 'string') {
    throw new Error('Route metadata manifest requires a fallback title and description')
  }
  if (!Array.isArray(manifest.stableRoutes) || manifest.stableRoutes.length === 0) {
    throw new Error('Route metadata manifest requires stable routes')
  }

  const paths = new Set()
  for (const route of manifest.stableRoutes) {
    if (typeof route.path !== 'string' || !/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(route.path)) {
      throw new Error(`Invalid stable route path: ${String(route.path)}`)
    }
    if (paths.has(route.path)) throw new Error(`Duplicate stable route path: ${route.path}`)
    if (typeof route.title !== 'string' || route.title.trim() === '') throw new Error(`Missing title for ${route.path}`)
    if (typeof route.description !== 'string' || route.description.trim() === '') throw new Error(`Missing description for ${route.path}`)
    paths.add(route.path)
  }
  if (!paths.has('/')) throw new Error('Route metadata manifest must include the homepage')
  if (manifest.fallback.canonicalPath !== '/') throw new Error('Unknown routes must canonicalize to the homepage')
  return manifest
}

export async function readRouteManifest(manifestUrl = DEFAULT_MANIFEST_URL) {
  return validateManifest(JSON.parse(await readFile(manifestUrl, 'utf8')))
}

export function renderRouteHtml(indexHtml, manifest, route) {
  const title = escapeHtml(route.title)
  const description = escapeHtml(route.description)
  const canonicalUrl = escapeHtml(`${manifest.siteOrigin}${route.path}`)

  let html = replaceSingleton(indexHtml, /<title>[^<]*<\/title>/g, `<title>${title}</title>`, 'title')
  html = replaceSingleton(html, /<meta\s+name="description"[^>]*>/g, `<meta name="description" content="${description}" />`, 'meta description')
  html = replaceSingleton(html, /<link\s+rel="canonical"[^>]*>/g, `<link rel="canonical" href="${canonicalUrl}" />`, 'canonical link')
  html = replaceSingleton(html, /<meta\s+property="og:title"[^>]*>/g, `<meta property="og:title" content="${title}" />`, 'Open Graph title')
  html = replaceSingleton(html, /<meta\s+property="og:description"[^>]*>/g, `<meta property="og:description" content="${description}" />`, 'Open Graph description')
  html = replaceSingleton(html, /<meta\s+property="og:url"[^>]*>/g, `<meta property="og:url" content="${canonicalUrl}" />`, 'Open Graph URL')
  html = replaceSingleton(html, /<meta\s+name="twitter:title"[^>]*>/g, `<meta name="twitter:title" content="${title}" />`, 'Twitter title')
  html = replaceSingleton(html, /<meta\s+name="twitter:description"[^>]*>/g, `<meta name="twitter:description" content="${description}" />`, 'Twitter description')
  return html
}

function routeIndexPath(distDir, routePath) {
  return routePath === '/' ? join(distDir, 'index.html') : join(distDir, routePath.slice(1), 'index.html')
}

export async function generateRouteHtml({
  distDir = resolve('dist'),
  manifestUrl = DEFAULT_MANIFEST_URL,
} = {}) {
  const manifest = await readRouteManifest(manifestUrl)
  const indexPath = join(distDir, 'index.html')
  const indexHtml = await readFile(indexPath, 'utf8')
  if (!indexHtml.includes('<div id="root"></div>')) {
    throw new Error(`Refusing to generate routes from an unexpected build artifact: ${indexPath}`)
  }

  for (const route of manifest.stableRoutes) {
    const outputPath = routeIndexPath(distDir, route.path)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, renderRouteHtml(indexHtml, manifest, route))
  }

  return {
    siteOrigin: manifest.siteOrigin,
    routes: manifest.stableRoutes.map((route) => route.path),
  }
}

const invokedPath = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href
if (invokedPath === import.meta.url) {
  const result = await generateRouteHtml()
  console.log(`Generated route metadata for ${result.routes.length} stable paths`)
}

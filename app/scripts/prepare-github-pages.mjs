import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateRouteHtml } from './generate-route-html.mjs'

const DEFAULT_DOMAIN = 'standing-live.dolepee.com'

function assertDomain(domain) {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error(`Invalid GitHub Pages domain: ${domain}`)
  }
}

export async function prepareGitHubPages({
  distDir = resolve('dist'),
  domain = process.env.STANDING_PAGES_DOMAIN || DEFAULT_DOMAIN,
} = {}) {
  assertDomain(domain)

  const indexPath = join(distDir, 'index.html')
  const sourceIndexHtml = await readFile(indexPath, 'utf8')
  if (!sourceIndexHtml.includes('<div id="root"></div>')) {
    throw new Error(`Refusing to prepare an unexpected build artifact: ${indexPath}`)
  }

  const generated = await generateRouteHtml({ distDir })
  const indexHtml = await readFile(indexPath, 'utf8')

  // GitHub Pages serves this document for paths that cannot have a concrete
  // static entry (for example /checkout/:planId), allowing BrowserRouter to
  // render a useful recovery page instead of a platform-branded dead end.
  await copyFile(indexPath, join(distDir, '404.html'))
  await writeFile(join(distDir, '.nojekyll'), '')
  await writeFile(join(distDir, 'CNAME'), `${domain}\n`)

  return { domain, indexHtml, routes: generated.routes }
}

const invokedPath = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href
if (invokedPath === import.meta.url) {
  await prepareGitHubPages()
}

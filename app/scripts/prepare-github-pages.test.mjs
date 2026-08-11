import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { prepareGitHubPages } from './prepare-github-pages.mjs'

const INDEX = `<!doctype html><html><head>
  <title>Standing</title>
  <meta name="description" content="Standing">
  <link rel="canonical" href="https://standing.dolepee.com/">
  <meta property="og:title" content="Standing">
  <meta property="og:description" content="Standing">
  <meta property="og:url" content="https://standing.dolepee.com/">
  <meta name="twitter:title" content="Standing">
  <meta name="twitter:description" content="Standing">
</head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>`

async function fixture() {
  const distDir = await mkdtemp(join(tmpdir(), 'standing-pages-'))
  await writeFile(join(distDir, 'index.html'), INDEX)
  return distDir
}

test('creates concrete judge routes, SPA recovery, and custom-domain controls', async () => {
  const distDir = await fixture()
  try {
    const result = await prepareGitHubPages({ distDir, domain: 'standing-live.dolepee.com' })

    assert.deepEqual(result.routes, ['/', '/demo', '/evidence', '/plans', '/mandates', '/merchant', '/legacy-recovery'])
    assert.equal(await readFile(join(distDir, 'CNAME'), 'utf8'), 'standing-live.dolepee.com\n')
    assert.equal(await readFile(join(distDir, '.nojekyll'), 'utf8'), '')
    assert.equal(await readFile(join(distDir, '404.html'), 'utf8'), await readFile(join(distDir, 'index.html'), 'utf8'))

    for (const route of result.routes.filter((route) => route !== '/')) {
      const routeHtml = await readFile(join(distDir, route.slice(1), 'index.html'), 'utf8')
      assert.match(routeHtml, new RegExp(`<link rel="canonical" href="https://standing\\.dolepee\\.com${route}"`))
    }

    // Re-running preparation must be safe for retried CI jobs.
    await prepareGitHubPages({ distDir, domain: 'standing-live.dolepee.com' })
  } finally {
    await rm(distDir, { recursive: true, force: true })
  }
})

test('fails closed on an invalid domain', async () => {
  const distDir = await fixture()
  try {
    await assert.rejects(
      prepareGitHubPages({ distDir, domain: 'https://standing.dolepee.com/path' }),
      /Invalid GitHub Pages domain/,
    )
  } finally {
    await rm(distDir, { recursive: true, force: true })
  }
})

test('fails closed when the build artifact is not the Standing app shell', async () => {
  const distDir = await fixture()
  try {
    await writeFile(join(distDir, 'index.html'), '<html>unexpected</html>')
    await assert.rejects(
      prepareGitHubPages({ distDir, domain: 'standing.dolepee.com' }),
      /unexpected build artifact/,
    )
  } finally {
    await rm(distDir, { recursive: true, force: true })
  }
})

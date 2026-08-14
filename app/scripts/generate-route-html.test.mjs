import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { generateRouteHtml } from './generate-route-html.mjs'

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
  const distDir = await mkdtemp(join(tmpdir(), 'standing-route-html-'))
  await writeFile(join(distDir, 'index.html'), INDEX)
  return distDir
}

function values(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1])
}

test('writes route-specific crawler metadata into every stable HTML response', async () => {
  const distDir = await fixture()
  try {
    const result = await generateRouteHtml({ distDir })
    assert.deepEqual(result.routes, ['/', '/demo', '/evidence', '/plans', '/mandates', '/merchant', '/legacy-recovery'])

    const expected = [
      ['index.html', 'Standing | Pay in XRP, land subscribed on Flare', 'https://standing.dolepee.com/'],
      ['demo/index.html', 'XRP Treasury Runbook Demo | Standing', 'https://standing.dolepee.com/demo'],
      ['evidence/index.html', 'Verified XRP-to-Flare Receipts | Standing', 'https://standing.dolepee.com/evidence'],
    ]
    for (const [file, title, canonicalUrl] of expected) {
      const html = await readFile(join(distDir, file), 'utf8')
      assert.deepEqual(values(html, /<title>([^<]*)<\/title>/g), [title])
      assert.deepEqual(values(html, /<link rel="canonical" href="([^"]+)" \/>/g), [canonicalUrl])
      assert.deepEqual(values(html, /<meta property="og:url" content="([^"]+)" \/>/g), [canonicalUrl])
      assert.deepEqual(values(html, /<meta property="og:title" content="([^"]+)" \/>/g), [title])
      assert.equal(values(html, /<meta name="description" content="([^"]+)" \/>/g).length, 1)
      assert.equal(values(html, /<meta property="og:description" content="([^"]+)" \/>/g).length, 1)
      assert.equal(values(html, /<meta name="twitter:title" content="([^"]+)" \/>/g).length, 1)
      assert.equal(values(html, /<meta name="twitter:description" content="([^"]+)" \/>/g).length, 1)
    }
  } finally {
    await rm(distDir, { recursive: true, force: true })
  }
})

test('fails closed instead of publishing duplicate crawler metadata', async () => {
  const distDir = await fixture()
  try {
    await writeFile(join(distDir, 'index.html'), INDEX.replace('</head>', '<link rel="canonical" href="https://duplicate.invalid/"></head>'))
    await assert.rejects(generateRouteHtml({ distDir }), /Expected exactly one canonical link/)
  } finally {
    await rm(distDir, { recursive: true, force: true })
  }
})

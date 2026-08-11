import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const projectRoot = new URL('../../', import.meta.url)

test('serves every generated stable route before the Vercel SPA fallback', async () => {
  const manifest = JSON.parse(await readFile(new URL('app/route-metadata.json', projectRoot), 'utf8'))
  const vercel = JSON.parse(await readFile(new URL('vercel.json', projectRoot), 'utf8'))
  const stablePaths = manifest.stableRoutes.map((route) => route.path).filter((path) => path !== '/')
  const fallbackIndex = vercel.rewrites.findIndex((rewrite) => rewrite.destination === '/index.html')

  assert.equal(vercel.trailingSlash, false)
  assert.equal(fallbackIndex, vercel.rewrites.length - 1, 'SPA fallback must remain last')
  for (const path of stablePaths) {
    const routeIndex = vercel.rewrites.findIndex((rewrite) => (
      rewrite.source === path && rewrite.destination === `${path}/index.html`
    ))
    assert.notEqual(routeIndex, -1, `missing static rewrite for ${path}`)
    assert.ok(routeIndex < fallbackIndex, `${path} must resolve before the SPA fallback`)
  }
})

import { expect, test } from '@playwright/test'

for (const path of ['/', '/plans', '/mandates', '/merchant', '/evidence']) {
  test(`${path} renders without horizontal overflow`, async ({ page }) => {
    const errors: string[] = []
    const failedRequests: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).origin === 'http://127.0.0.1:4173') {
        failedRequests.push(`${request.method()} ${request.url()}`)
      }
    })
    await page.goto(path)
    await expect(page.locator('header')).toBeVisible()
    await expect(page.locator('main')).not.toBeEmpty()
    await page.waitForTimeout(800)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    expect(errors).toEqual([])
    expect(failedRequests).toEqual([])
  })
}

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('opens and navigates with the keyboard', async ({ page }) => {
    await page.goto('/')
    const menu = page.getByRole('button', { name: 'Open navigation' })
    await menu.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
    await page.getByRole('link', { name: 'Evidence', exact: true }).click()
    await expect(page).toHaveURL(/\/evidence$/)
    await expect(page.getByRole('heading', { name: 'The rails are testnet-live.' })).toBeVisible()
  })
})

test('missing wallet is handled inside the product surface', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByText('Transaction stopped')).toBeVisible()
  await expect(page.getByText('Install an EVM wallet to continue')).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('wrong-network writes tell the user to switch chains', async ({ page }) => {
  await page.addInitScript(() => {
    const account = '0x1111111111111111111111111111111111111111'
    window.ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') return [account]
        if (method === 'eth_chainId') return '0x1'
        throw new Error(`Unexpected wallet method: ${method}`)
      },
      on: () => undefined,
      removeListener: () => undefined,
    }
  })
  await page.goto('/merchant')
  await page.getByRole('button', { name: 'Create plan' }).click()
  await expect(page.getByText('Transaction stopped')).toBeVisible()
  await expect(page.getByText('Switch to Coston2 first')).toBeVisible()
})

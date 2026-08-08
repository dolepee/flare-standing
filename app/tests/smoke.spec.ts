import { expect, test } from '@playwright/test'

for (const path of ['/', '/plans', '/checkout/2', '/mandates', '/access/2', '/merchant', '/evidence']) {
  test(`${path} renders without horizontal overflow`, async ({ page }) => {
    const errors: string[] = []
    const failedRequests: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).origin === new URL(page.url()).origin) {
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

test('named checkout resolves against the live onchain plan', async ({ page }) => {
  await page.goto('/checkout/2')
  await expect(page.getByRole('heading', { name: 'FTSO Creator Pass' })).toBeVisible()
  await expect(page.getByText('Controlled pilot')).toBeVisible()
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Connect wallet' })).toBeVisible()
})

test('canceled mandate keeps the reference entitlement locked', async ({ page }) => {
  await page.goto('/access/2')
  await expect(page.getByRole('heading', { name: 'Creator member dispatch' })).toBeVisible()
  await expect(page.getByText('Access ended')).toBeVisible()
  await expect(page.getByText('The latest edition is unlocked.')).toHaveCount(0)
})

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
    await expect(page.getByRole('heading', { name: 'One XRP payment. One live mandate.' })).toBeVisible()
  })
})

test('evidence publishes the bounded external pilot and its closeout proofs', async ({ page }) => {
  await page.goto('/evidence')
  await expect(page.getByRole('heading', { name: 'One XRP payment. One live mandate.' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Atomic XRP subscription payment/ })).toHaveAttribute('href', /09BFC17FE831A80069362F34F56EC98B348787A143EA46C313811DC3E178729A$/)
  await expect(page.getByRole('link', { name: /Atomic FXRP mint \+ mandate 5/ })).toHaveAttribute('href', /0x712d68f0a2672123fdc2b18bef1df6eb85d0539b00dc3011c5321aa8342b9064$/)
  await expect(page.getByText('Plan 4 · 1 FXRP prepaid capacity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Separate merchant and subscriber wallets completed the loop.' })).toBeVisible()
  await expect(page.getByText('Standing made the recurring Coston2 payment lifecycle easy to verify from plan creation through merchant withdrawal.')).toBeVisible()
  await expect(page.getByText(/Virtual attribution, subscriber independence, and the quote are participant attestations/i)).toBeVisible()
  await expect(page.getByText(/not production adoption, recurring revenue, a mainnet customer, a partnership/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /Scheduled FTSO charge/ })).toHaveAttribute('href', /0x0b645b0c6bc4d8e510b84303cb879f2d945c3480358405bba3c9df8f7297aef7$/)
  await expect(page.getByRole('link', { name: /Virtual claims accrual/ })).toHaveAttribute('href', /0xb1f66ae4984b278c3d01dc58c389339fb80c2e3d22d6caf32acd346b34fe5e0c$/)
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

test('adding Coston2 is followed by an explicit verified switch', async ({ page }) => {
  await page.addInitScript(() => {
    const account = '0x1111111111111111111111111111111111111111'
    let activeChain = '0x1'
    let switchCalls = 0
    const calls: string[] = []
    ;(window as unknown as { walletCalls: string[] }).walletCalls = calls
    window.ethereum = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        calls.push(method)
        if (method === 'eth_accounts') return [account]
        if (method === 'eth_chainId') return activeChain
        if (method === 'wallet_addEthereumChain') return null
        if (method === 'wallet_switchEthereumChain') {
          switchCalls += 1
          if (switchCalls === 1) throw Object.assign(new Error('Unknown chain'), { code: 4902 })
          const chainParameter = params?.[0] as { chainId?: string } | undefined
          if (!chainParameter?.chainId) throw new Error('Missing chain ID')
          activeChain = chainParameter.chainId
          return null
        }
        throw new Error(`Unexpected wallet method: ${method}`)
      },
      on: () => undefined,
      removeListener: () => undefined,
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to Coston2' }).click()
  await expect(page.getByRole('button', { name: /0x1111.*1111/ })).toBeVisible()
  const calls = await page.evaluate(() => (window as unknown as { walletCalls: string[] }).walletCalls)
  expect(calls.filter((method) => method === 'wallet_switchEthereumChain')).toHaveLength(2)
  expect(calls).toContain('wallet_addEthereumChain')
  expect(calls.at(-1)).toBe('eth_chainId')
})

test('network-switch failures preserve wallet detail and explain recovery', async ({ page }) => {
  await page.addInitScript(() => {
    const account = '0x1111111111111111111111111111111111111111'
    window.ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') return [account]
        if (method === 'eth_chainId') return '0x1'
        if (method === 'wallet_switchEthereumChain') {
          throw { code: -32603, message: 'The wallet could not switch networks' }
        }
        throw new Error(`Unexpected wallet method: ${method}`)
      },
      on: () => undefined,
      removeListener: () => undefined,
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to Coston2' }).click()
  await expect(page.getByText('Transaction stopped')).toBeVisible()
  await expect(page.getByText(/The wallet could not switch networks.*add or select Coston2 \(chain 114\)/)).toBeVisible()
})

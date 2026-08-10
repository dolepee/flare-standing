import { expect, test } from '@playwright/test'

for (const path of ['/', '/plans', '/checkout/1', '/mandates', '/access/1', '/merchant', '/evidence', '/legacy-recovery']) {
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
  await page.goto('/checkout/1')
  await expect(page.getByRole('heading', { name: 'Atomic XRP Access Pass' })).toBeVisible()
  await expect(page.getByText('Controlled fixture')).toBeVisible()
  await expect(page.getByText('V2 live')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Prepare Coston2 before checkout' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open official faucet/ })).toHaveAttribute('href', 'https://faucet.flare.network/')
  await expect(page.getByText('Exact initial-charge ceiling')).toBeVisible()
  await expect(page.getByRole('complementary').getByText('0.1 FTestXRP').first()).toBeVisible()
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Connect wallet' })).toBeVisible()
})

test('first fold leads with the immediately useful XRP-funded subscription', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Pay in XRP. Land subscribed on Flare.' })).toBeVisible()
  await expect(page.getByText('Immediate proof', { exact: true })).toBeVisible()
  await expect(page.getByText('Live V2 checkout', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open exact XRPL transaction/ })).toHaveAttribute('href', /54E9F5D3CFEAF5236DD6BE5B8624D8AAE69307D02D027E594B6AA023D756C0FD$/)
  await page.getByRole('button', { name: /03 Activate access/ }).click()
  await expect(page.getByRole('heading', { name: 'The subscription opens and pays immediately.' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Inspect open \+ first-charge receipt/ })).toHaveAttribute('href', /0x119d29cf92a5a41ae504b151bd6ab5e6bc1d86855f58673fe5f3b4e5d158b2c9$/)
  await expect(page.getByRole('heading', { name: 'Mandate 1 now' })).toBeVisible()
  await expect(page.getByText(/Paid · (active|charge due)/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Try Coston2 checkout' })).toHaveAttribute('href', '/checkout/1')
})

test('fixed-price checkout displays the exact initial charge ceiling', async ({ page }) => {
  await page.goto('/checkout/1')
  await expect(page.getByLabel('Maximum initial charge')).toHaveCount(0)
  await expect(page.getByText('Exact initial-charge ceiling')).toBeVisible()
  await expect(page.getByText('Fixed-price plans use the exact plan price, never the whole deposit.')).toBeVisible()
})

test('V2 checkout presents the live open-and-first-charge action', async ({ page }) => {
  await page.goto('/checkout/1')
  await expect(page.getByText('V2 live')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open with access paid' })).toBeVisible()
  await expect(page.getByText(/transaction must both open the test mandate and emit its first ChargeExecuted event/)).toBeVisible()
})

test('merchant capability stays discoverable without occupying primary navigation', async ({ page }) => {
  await page.goto('/plans')
  await expect(page.getByRole('link', { name: 'Merchant testnet tools' })).toHaveAttribute('href', '/merchant')
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: /Merchant/ })).toHaveCount(0)
})

test('historical V1 recovery is linked but excluded from primary navigation', async ({ page }) => {
  await page.goto('/mandates')
  await expect(page.getByRole('link', { name: 'Historical V1 recovery' })).toHaveAttribute('href', '/legacy-recovery')
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: /Historical V1 recovery/ })).toHaveCount(0)

  await page.goto('/evidence')
  await expect(page.getByRole('link', { name: 'Historical V1 recovery' })).toHaveAttribute('href', '/legacy-recovery')
})

test('historical recovery defaults to V1 read-only state with no forbidden controls', async ({ page }) => {
  await page.goto('/legacy-recovery')
  await expect(page.getByRole('heading', { name: 'Exit an old mandate without reopening it.' })).toBeVisible()
  await expect(page.getByText(/cannot recover XRPL-derived Personal or Smart Accounts/i)).toBeVisible()
  await expect(page.getByText('0x8a29c741280554028d76666dc75558d98caab855')).toBeVisible()
  await expect(page.getByRole('link', { name: /Inspect V1 contract/ })).toHaveAttribute('href', /0x8a29c741280554028d76666dc75558d98caab855$/i)
  await expect(page.getByText('Historical V1 mandate #5')).toBeVisible()
  await expect(page.getByRole('button', { name: /Open mandate|Top up|Run charge|Create plan|Withdraw merchant/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Cancel V1 mandate|Withdraw canceled balance/i })).toHaveCount(0)
})

test('historical recovery does not misrepresent the funded Personal Account as browser-recoverable', async ({ page }) => {
  await page.addInitScript(() => {
    const account = '0x230068eE8262BE1A7DF36f55Ebb17F64Cc8F7890'
    window.ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') return [account]
        if (method === 'eth_chainId') return '0x72'
        throw new Error(`Unexpected wallet method: ${method}`)
      },
      on: () => undefined,
      removeListener: () => undefined,
    }
  })
  await page.goto('/legacy-recovery')
  await expect(page.getByText('Coston2 ready')).toBeVisible()
  await expect(page.getByText('Personal Account · read only')).toBeVisible()
  await expect(page.getByText(/browser EOA cannot recover it/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Cancel V1 mandate|Withdraw canceled balance/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Open mandate|Top up|Run charge|Create plan|Withdraw merchant/i })).toHaveCount(0)
})

test('the verified mandate has a direct subscriber-access surface', async ({ page }) => {
  await page.goto('/access/1')
  await expect(page.getByRole('heading', { name: 'Atomic XRP subscriber brief' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mandate #1' })).toBeVisible()
})

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('opens and navigates with the keyboard', async ({ page }) => {
    await page.goto('/')
    const menu = page.getByRole('button', { name: 'Open navigation' })
    await menu.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).not.toBeVisible()
    await expect(menu).toBeFocused()
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: 'Receipts', exact: true }).click()
    await expect(page).toHaveURL(/\/evidence$/)
    await expect(page.getByRole('heading', { name: 'Inspect every proof at its source.' })).toBeVisible()
  })
})

test('evidence publishes the bounded external pilot and its closeout proofs', async ({ page }) => {
  await page.goto('/evidence')
  await expect(page.getByRole('heading', { name: 'Inspect every proof at its source.' })).toBeVisible()
  await expect(page.getByRole('link', { name: /User-authorized XRP payment/ })).toHaveAttribute('href', /54E9F5D3CFEAF5236DD6BE5B8624D8AAE69307D02D027E594B6AA023D756C0FD$/)
  await expect(page.getByRole('link', { name: /Direct mint \+ open \+ first charge/ })).toHaveAttribute('href', /0x119d29cf92a5a41ae504b151bd6ab5e6bc1d86855f58673fe5f3b4e5d158b2c9$/)
  await expect(page.getByRole('link', { name: /Permissionless recurring keeper charge/ })).toHaveAttribute('href', /0x8c3333505617ef62e2b2823cb0c95ce4ee81a6e601e80978b285865f94d5a2a9$/)
  await expect(page.getByText('0.1 charged · 0.099 merchant · 0.001 fee · 0.9 remains')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Separate addresses completed a Coston2 billing loop.' })).toBeVisible()
  await expect(page.getByText('Standing made the recurring Coston2 payment lifecycle easy to verify from plan creation through merchant withdrawal.')).toBeVisible()
  await expect(page.getByText(/Virtual attribution, participant independence, and the quote are attestations/i)).toBeVisible()
  await expect(page.getByText(/not production adoption, recurring revenue, a mainnet customer, a partnership/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /Scheduled FTSO charge/ })).toHaveAttribute('href', /0x0b645b0c6bc4d8e510b84303cb879f2d945c3480358405bba3c9df8f7297aef7$/)
  await expect(page.getByRole('link', { name: /Merchant wallet claims accrual/ })).toHaveAttribute('href', /0xb1f66ae4984b278c3d01dc58c389339fb80c2e3d22d6caf32acd346b34fe5e0c$/)
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

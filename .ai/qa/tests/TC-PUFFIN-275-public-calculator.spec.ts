import { expect, test } from '@playwright/test'

const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
const PAGE_URL = '/demo_puffin/cloud-pricing-calculator'

/**
 * XD-275 Public Pricing Calculator — happy-path integration spec.
 *
 * Walks chooser → custom flow → add a product → submit lead form (captcha
 * disabled in dev) → expect a confirmation screen. The test runs against the
 * Puffin tenant seeded by XD-276; if the calculator isn't configured (missing
 * `PUFFIN_PUBLIC_LEAD_JWT_SECRET`) the page renders the OpsBanner and the
 * test will fail with a clear message rather than a timeout.
 */

test.describe('TC-PUFFIN-275: Public Pricing Calculator', () => {
  test('chooser → custom → add VPS → cart shows pricing', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' })

    // Bail early with a clear message when the calculator isn't configured.
    const bannerVisible = await page.locator('text=Calculator unavailable').isVisible().catch(() => false)
    if (bannerVisible) {
      throw new Error(
        'Public calculator is not configured in this environment. ' +
          'Set PUFFIN_PUBLIC_LEAD_JWT_SECRET in .env.local before running this spec.',
      )
    }

    // Chooser visible.
    await expect(page.getByTestId('chooser-custom')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('chooser-custom').click()

    // Catalogue visible — VPS spec card or any add button is good enough as a
    // smoke check (offering codes are seed-stable per XD-276).
    const addVps = page.getByTestId('add-vps_small')
    await expect(addVps).toBeVisible({ timeout: 30_000 })
    await addVps.click()

    // Cart drawer reflects the addition.
    await expect(page.getByTestId('cart-drawer')).toBeVisible()

    // The "/ mo" total appears once /price returns. Allow up to 5s for the
    // server-side proxy hop + price calc.
    await expect(page.locator('[data-testid="cart-drawer"]').getByText('/ mo')).toBeVisible({
      timeout: 5_000,
    })
  })

  test('lead form opens from cart and submits a quote', async ({ page }) => {
    await page.goto(`${PAGE_URL}?flow=custom`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('add-vps_small')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('add-vps_small').click()

    // Click "Get a quote" in the cart drawer.
    const cart = page.getByTestId('cart-drawer')
    await expect(cart).toBeVisible()
    await cart.getByRole('button', { name: /get a quote/i }).click()

    // Lead form slide-over visible.
    const form = page.getByTestId('lead-form')
    await expect(form).toBeVisible()

    // Fill in the 3-field form. Captcha is disabled in dev so no token is
    // required; the test environment relies on the default disabled provider.
    await form.locator('input[type="text"]').first().fill('Jane Doe')
    await form.locator('input[type="email"]').fill('jane.doe@example.test')
    await form.locator('input[type="text"]').last().fill('Doe Co')
    await form.getByRole('button', { name: /send quote request/i }).click()

    // The confirmation screen appears once the leads + quotes calls succeed.
    // The confirmation screen text is stable: "Thanks — we've got it."
    await expect(page.getByText(/Thanks/i)).toBeVisible({ timeout: 15_000 })
  })

  test('OpsBanner renders for unconfigured deploys', async ({ page, request }) => {
    // Probe the config endpoint — when not configured it returns 503. We use
    // the response status to decide whether the banner check is meaningful.
    const cfgRes = await request.get(`${baseUrl}/api/demo_puffin/cloud-pricing-calculator/config`)
    if (cfgRes.status() === 200) {
      test.skip(true, 'Calculator is configured in this environment — banner test is not applicable')
    }

    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Calculator unavailable')).toBeVisible({ timeout: 30_000 })
  })
})

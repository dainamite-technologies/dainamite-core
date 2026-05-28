import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const baseUrl = process.env.BASE_URL || 'http://localhost:3000'

async function setGermanLocale(page: Page) {
  await page.context().addCookies([
    {
      name: 'locale',
      value: 'de',
      url: baseUrl,
      sameSite: 'Lax',
    },
  ])
}

test.describe('TC-APP-001: Template metadata', () => {
  test('home page exposes localized app metadata', async ({ page }) => {
    await setGermanLocale(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'KI-unterstützte, modulare ERP-Basis für Produkt- und Dienstleistungsunternehmen',
    )
  })

  test('backend pages resolve translated and direct titles', async ({ page }) => {
    await setGermanLocale(page)
    await login(page, 'superadmin')

    // Next.js dev mode compiles routes on-demand — first hit can take longer
    // than the default 5s expect-timeout, so we bump it for these gotos.
    // The core Users page ships a German title, exercising translated resolution...
    await page.goto('/backend/users', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle('Benutzer', { timeout: 30_000 })

    // ...while CPQ pages have no German translation and fall back to the
    // literal English title under the `de` locale.
    await page.goto('/backend/cpq/quotes', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle('CPQ Quotes', { timeout: 30_000 })
  })
})

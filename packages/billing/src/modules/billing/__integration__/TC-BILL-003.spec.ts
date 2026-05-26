import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-BILL-003: Billing admin UI — Polish locale
 * Category: BILL — UI
 * Priority: Medium
 *
 * Verifies that the Polish i18n dictionary loads on the accounts list
 * page when the `locale=pl` cookie is set.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000'

test.describe('TC-BILL-003: Billing admin UI (accounts)', () => {
  test('renders Polish copy when the locale cookie is set', async ({ page }) => {
    await login(page, 'admin')
    await page.context().addCookies([
      { name: 'locale', value: 'pl', url: BASE },
    ])
    await page.goto('/backend/billing/accounts', { waitUntil: 'domcontentloaded' })

    // pl.json: billing.accounts.title → "Konta rozliczeniowe".
    await expect(
      page.getByRole('heading', { name: /Konta rozliczeniowe/i }).first(),
    ).toBeVisible({ timeout: 15_000 })
  })
})

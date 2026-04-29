import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-CPQ-011: Orders list page (UI)
 * Category: CPQ — UI
 * Priority: Medium
 *
 * Smoke test for the orders list — empty state must not crash, headings are
 * present, and the page loads under admin auth.
 */

test.describe('TC-CPQ-011: Orders list page (UI)', () => {
  test('admin can open the orders list', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/cpq/orders', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { level: 1, name: /CPQ Orders/i })).toBeVisible({ timeout: 15_000 })

    // Page rendered some content — table or empty-state message
    await expect(page.locator('body')).not.toBeEmpty()
  })
})

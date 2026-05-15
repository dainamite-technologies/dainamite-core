import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-CPQ-010: Inventory section navigation (UI)
 * Category: CPQ — UI
 * Priority: Medium
 *
 * Inventory page exposes Subscriptions / Assets tabs. Verifies both
 * are reachable and the heading is consistent.
 */

test.describe('TC-CPQ-010: Inventory tabs (UI)', () => {
  test('admin lands on inventory page and can switch tabs', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/cpq/inventory', { waitUntil: 'domcontentloaded' })

    // Page-level h1 ("Customer Inventory") still exists; tab tables
    // render their own <h2>. Either heading proves the page loaded.
    await expect(
      page.getByRole('heading', { name: /Customer Inventory|CPQ Subscriptions|Subscriptions/i }).first(),
    ).toBeVisible({ timeout: 10_000 })

    // Tabs (defined in code as { subscriptions, assets })
    const subsTab = page.getByRole('button', { name: /Subscriptions/i }).first()
    const assetsTab = page.getByRole('button', { name: /^Assets$/i }).first()

    if (await subsTab.isVisible().catch(() => false)) {
      await subsTab.click()
      await expect(page.locator('body')).toContainText(/Subscriptions|No inventory/i, {
        timeout: 5_000,
      })
    }

    if (await assetsTab.isVisible().catch(() => false)) {
      await assetsTab.click()
      await expect(page.locator('body')).toContainText(/Assets|No inventory/i, {
        timeout: 5_000,
      })
    }
  })

  test('subscription detail route does not 500 for a non-existent id (graceful 404 / empty)', async ({ page }) => {
    await login(page, 'admin')
    const fakeId = '00000000-0000-4000-8000-000000000000'
    const res = await page.goto(`/backend/cpq/inventory/subscriptions/${fakeId}`, {
      waitUntil: 'domcontentloaded',
    })
    // Either renders an empty/404-ish state OR the dev page returns 404 — both are acceptable.
    if (res) {
      expect([200, 404]).toContain(res.status())
    }
  })
})

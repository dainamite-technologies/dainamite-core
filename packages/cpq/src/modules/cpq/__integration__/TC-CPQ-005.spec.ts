import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-CPQ-005: CPQ admin sidebar wiring (UI)
 * Category: CPQ — UI
 * Priority: High
 *
 * After admin login, the CPQ section in the sidebar must surface every
 * page registered with `pageGroup: 'CPQ'`. This is the first signal that
 * the module's `requireFeatures` map and admin role ACLs are still aligned.
 */

test.describe('TC-CPQ-005: CPQ sidebar (UI)', () => {
  test('admin sees all CPQ list pages and reaches them via direct navigation', async ({ page }) => {
    await login(page, 'admin')

    const cpqRoutes = [
      { url: '/backend/cpq/specifications', heading: /Product Specifications/i },
      { url: '/backend/cpq/offerings', heading: /Product Offerings/i },
      { url: '/backend/cpq/quotes', heading: /CPQ Quotes/i },
      { url: '/backend/cpq/orders', heading: /CPQ Orders/i },
      { url: '/backend/cpq/pricing', heading: /Pricing Tables/i },
      { url: '/backend/cpq/inventory', heading: /Customer Inventory|CPQ Subscriptions|Inventory/i },
      { url: '/backend/cpq/wizards', heading: /Wizards/i },
      { url: '/backend/cpq/price-rules', heading: /Price Rules/i },
    ] as const

    for (const route of cpqRoutes) {
      await page.goto(route.url, { waitUntil: 'domcontentloaded' })

      // Page must not be a 401 / "access denied" redirect for an admin.
      expect(page.url(), `nav to ${route.url} bounced to ${page.url()}`).toContain(route.url)

      // List page renders the title inside DataTable as an <h2> after the
      // CpqListView refactor (commit 8c64a55); accept any heading level.
      await expect(
        page.getByRole('heading', { name: route.heading }).first(),
        `expected heading matching ${route.heading} on ${route.url}`,
      ).toBeVisible({ timeout: 10_000 })
    }
  })
})

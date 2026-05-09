import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CPQ-007: Offerings list page (UI)
 * Category: CPQ — UI
 * Priority: Medium
 *
 * Renders a created offering on the list and verifies the column headers.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

test.describe('TC-CPQ-007: Offerings list page (UI)', () => {
  test('renders heading, headers, and a freshly created offering', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const cleanup: Array<() => Promise<void>> = []

    try {
      // Spec
      const specCode = `UI-${uniq()}`
      const specRes = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
        token,
        data: { code: specCode, name: 'UI Spec for Offerings', lifecycleStatus: 'active' },
      })
      expect(specRes.ok()).toBeTruthy()
      const spec = (await specRes.json()) as { id: string }
      cleanup.push(() =>
        apiRequest(request, 'DELETE', '/api/cpq/product-specifications', {
          token,
          data: { id: spec.id },
        }).then(() => undefined),
      )

      // Offering
      const offeringCode = `UI-OF-${uniq()}`
      const offRes = await apiRequest(request, 'POST', '/api/cpq/product-offerings', {
        token,
        data: {
          specId: spec.id,
          code: offeringCode,
          name: `UI Offering ${offeringCode}`,
          lifecycleStatus: 'active',
        },
      })
      expect(offRes.ok()).toBeTruthy()
      const offering = (await offRes.json()) as { id: string }
      cleanup.push(() =>
        apiRequest(request, 'DELETE', '/api/cpq/product-offerings', {
          token,
          data: { id: offering.id },
        }).then(() => undefined),
      )

      // UI
      await login(page, 'admin')
      await page.goto('/backend/cpq/offerings', { waitUntil: 'domcontentloaded' })

      await expect(page.getByRole('heading', { level: 1, name: /Product Offerings/i })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: /New Offering/i })).toBeVisible({ timeout: 15_000 })

      // Column headers (English fallback)
      const tableScope = page.locator('table').first()
      await expect(tableScope.locator('th', { hasText: /^Code/i }).first()).toBeVisible()
      await expect(tableScope.locator('th', { hasText: /^Name/i }).first()).toBeVisible()

      // Row with our unique offering
      await expect(page.locator('tr', { hasText: offeringCode }).first()).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      for (const f of cleanup.reverse()) await f().catch(() => undefined)
    }
  })
})

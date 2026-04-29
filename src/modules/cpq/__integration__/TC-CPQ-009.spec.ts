import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CPQ-009: Pricing tables list (UI)
 * Category: CPQ — UI
 * Priority: Medium
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

test.describe('TC-CPQ-009: Pricing tables list (UI)', () => {
  test('renders heading + freshly created table appears in the list', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')

    const code = `PT-${uniq()}`
    const created = await apiRequest(request, 'POST', '/api/cpq/pricing-tables', {
      token,
      data: {
        code,
        name: `UI Pricing Table ${code}`,
        dimensions: [{ key: 'dc', label: 'Datacenter' }],
        priceColumns: [{ key: 'list', label: 'List' }],
        currencyCodeList: ['USD'],
      },
    })
    expect(created.ok(), `pricing table POST returned ${created.status()}`).toBeTruthy()
    const table = (await created.json()) as { id: string }

    try {
      await login(page, 'admin')
      await page.goto('/backend/cpq/pricing', { waitUntil: 'domcontentloaded' })

      await expect(page.getByRole('heading', { level: 1, name: /Pricing Tables/i })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('body')).toContainText(code, { timeout: 15_000 })
    } finally {
      await apiRequest(request, 'DELETE', '/api/cpq/pricing-tables', {
        token,
        data: { id: table.id },
      }).catch(() => undefined)
    }
  })
})

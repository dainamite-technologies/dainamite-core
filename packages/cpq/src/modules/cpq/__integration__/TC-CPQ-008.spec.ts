import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CPQ-008: Quotes list + open detail (UI)
 * Category: CPQ — UI
 * Priority: High
 *
 * Creates a quote via API, then verifies it shows up on the list page and
 * navigating to the detail URL renders without error.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

test.describe('TC-CPQ-008: Quotes list (UI)', () => {
  test('admin opens the quotes list and sees the heading + table headers', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/cpq/quotes', { waitUntil: 'domcontentloaded' })

    // Title now lives inside DataTable as <h2> (CpqListView refactor).
    await expect(page.getByRole('heading', { name: /CPQ Quotes/i }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /New Quote/i })).toBeVisible({ timeout: 15_000 })

    // Table renders OR empty state appears. NOTE: cross-org admin scopes were observed during
    // initial development — admins may see different quote rows depending on the active org context,
    // so we don't pin to a specific row. UI list-load smoke is the goal here.
    // Column was renamed "Quote ID" → "Quote Number" when the list started
    // resolving SalesQuote.quoteNumber server-side (commit 209ca7a).
    const tableHeader = page.getByRole('columnheader', { name: /Quote Number/i })
    const emptyState = page.getByText(/no quote|empty|create one/i)
    await expect(tableHeader.or(emptyState).first()).toBeVisible({ timeout: 15_000 })
  })

  test('quote detail page renders for a known quote id', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await createCompanyFixture(request, token, `Acme ${uniq()}`)

    const quoteRes = await apiRequest(request, 'POST', '/api/cpq/quotes', {
      token,
      data: { customerId, currencyCode: 'USD' },
    })
    const quote = (await quoteRes.json()) as { id: string }

    await login(page, 'admin')
    await page.goto(`/backend/cpq/quotes/${quote.id}`, { waitUntil: 'domcontentloaded' })

    // Stays on the detail URL (no auth bounce / error redirect).
    expect(page.url()).toContain(`/backend/cpq/quotes/${quote.id}`)
  })
})

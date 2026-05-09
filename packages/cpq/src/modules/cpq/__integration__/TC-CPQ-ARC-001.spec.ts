import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  seedActiveSubscription,
  seedCustomer,
  deleteSubscription,
  deleteCustomer,
  hideFloatingOverlays,
} from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-ARC-001 — Amend flow via UI (XD-250)
 *
 * Operator opens an active subscription, clicks "Amend", drawer attaches the
 * source sub as the (sole) target, submits. The quote detail page renders
 * the ARC summary banner with the attached target.
 */
test.describe('TC-CPQ-ARC-001 — Amend flow (UI)', () => {
  test('opens Amend drawer from subscription detail and the new quote shows the target in the ARC banner', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const sub = await seedActiveSubscription(request, token, { customerId })

    try {
      await login(page, 'admin')

      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)

      // Header buttons render only for active/suspended subs.
      const amendBtn = page.getByRole('button', { name: /^Amend$/ })
      await expect(amendBtn).toBeVisible({ timeout: 15_000 })

      await amendBtn.click()

      // After click, startArcQuote() POSTs from-subscription then router.push()es
      // to /backend/cpq/quotes/[newId]. Poll for an element specific to the
      // quote detail with the ARC banner — survives Turbopack cold-compile.
      await expect(page.locator('body')).toContainText(sub.code, { timeout: 15_000 })
      await expect(page.getByText(/1 target/i).first()).toBeVisible({ timeout: 5_000 })
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

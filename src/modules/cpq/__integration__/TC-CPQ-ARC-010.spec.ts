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
 * TC-CPQ-ARC-010 — Change History audit empty state (UI) (XD-250 scenario 10)
 *
 * The subscription detail page renders a `Change History (N)` section that
 * lists `CpqSubscriptionChangeLog` rows. On a freshly-created sub (no ARC
 * activations yet) the section MUST render with `Change History (0)` and
 * the empty message "No ARC changes yet." Verifies the section is wired to
 * the change-log API and renders the empty branch correctly.
 */
test.describe('TC-CPQ-ARC-010 — Change History empty state (UI)', () => {
  test('fresh subscription renders Change History (0) with the empty placeholder', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const sub = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Fresh sub — no ARC history',
    })

    try {
      await login(page, 'admin')
      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)

      const heading = page.getByRole('heading', { name: /Change History/i })
      await expect(heading).toBeVisible({ timeout: 15_000 })
      await expect(heading).toContainText('(0)')
      await expect(page.locator('body')).toContainText(/No ARC changes yet/i, {
        timeout: 5_000,
      })
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

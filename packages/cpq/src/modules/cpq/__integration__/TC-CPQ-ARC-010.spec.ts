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
 * TC-CPQ-ARC-010 — Change History "Created" seed entry (UI) (XD-250 scenario 10)
 *
 * Commit fa5b899 made `createSubscription` write a `created` row into
 * `CpqSubscriptionChangeLog` so the history panel is never empty —
 * operators always see where the subscription came from before any
 * ARC operation. This test verifies:
 *   - Change History renders with one row (the "Created" seed)
 *   - the row is tagged "Created" rather than "Amended" / "Renewed" / etc.
 */
test.describe('TC-CPQ-ARC-010 — Change History seeded with Created (UI)', () => {
  test('fresh subscription renders Change History (1) with a "Created" entry', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const sub = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Fresh sub — seeded Created entry',
    })

    try {
      await login(page, 'admin')
      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)

      const heading = page.getByRole('heading', { name: /Change History/i })
      await expect(heading).toBeVisible({ timeout: 15_000 })
      // Subscription was just created → exactly one log row.
      await expect(heading).toContainText('(1)')
      // Scope the "Created" lookup to the Change History container so
      // the assertion can't accidentally match the "Created" Field
      // label on the Pricing & References meta card above.
      const historySection = page
        .locator('div', { has: heading })
        .first()
      await expect(historySection.getByText(/^Created$/).first()).toBeVisible({
        timeout: 5_000,
      })
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

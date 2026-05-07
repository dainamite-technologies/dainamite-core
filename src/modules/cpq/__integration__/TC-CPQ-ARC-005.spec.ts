import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  seedActiveSubscription,
  seedCustomer,
  daysFromNow,
  deleteSubscription,
  deleteCustomer,
  hideFloatingOverlays,
} from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-ARC-005 — Expiring Subscriptions list (UI) (XD-250)
 *
 * Seeds 3 subscriptions for the same customer with currentTermEnd at +5d /
 * +20d / +60d. Visits /backend/cpq/inventory/subscriptions/expiring with the
 * 30d window and asserts only the first two are visible (the +60d one is
 * outside the window).
 */
test.describe('TC-CPQ-ARC-005 — Expiring view filter (UI)', () => {
  test('30-day window includes only subs with currentTermEnd within the window', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const subSoon = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Expiring Soon',
      currentTermEnd: daysFromNow(5),
    })
    const subSoonish = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Expiring Soonish',
      currentTermEnd: daysFromNow(20),
    })
    const subLater = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Expiring Later',
      currentTermEnd: daysFromNow(60),
    })

    try {
      await login(page, 'admin')

      await page.goto('/backend/cpq/inventory/subscriptions/expiring', {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)

      await expect(
        page.getByRole('heading', { name: /Expiring Subscriptions/i, level: 1 }),
      ).toBeVisible({ timeout: 15_000 })

      // 30d preset is selected by default. Soon (5d) + Soonish (20d) visible,
      // Later (60d) NOT visible.
      const body = page.locator('body')
      await expect(body).toContainText(subSoon.code, { timeout: 15_000 })
      await expect(body).toContainText(subSoonish.code, { timeout: 5_000 })
      await expect(body).not.toContainText(subLater.code)

      // Switch to 90d preset → all three should appear.
      await page.getByRole('button', { name: /^90d$/ }).click()
      await expect(body).toContainText(subLater.code, { timeout: 10_000 })
    } finally {
      await deleteSubscription(request, token, subSoon.id).catch(() => undefined)
      await deleteSubscription(request, token, subSoonish.id).catch(() => undefined)
      await deleteSubscription(request, token, subLater.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

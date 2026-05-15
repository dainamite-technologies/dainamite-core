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
 * TC-CPQ-ARC-005 — Expiring Subscriptions filter (UI) (XD-250)
 *
 * The standalone `/expiring` page was retired (commit fa5b899) in favour
 * of an `expiringWithinDays` filter + saved-perspective workflow on the
 * main subscriptions list. This test now drives the inline expiring
 * picker that sits in the title row of the Subscriptions tab.
 *
 * Seeds 3 subscriptions with currentTermEnd at +5d / +20d / +60d.
 * Picking "Expiring in 30 days" shows the first two; switching to "90
 * days" reveals the third.
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

      // Land on the Subscriptions tab of the main inventory page.
      await page.goto('/backend/cpq/inventory', { waitUntil: 'domcontentloaded' })
      await hideFloatingOverlays(page)

      // All three seeded subs initially visible (no window filter yet).
      const body = page.locator('body')
      await expect(body).toContainText(subSoon.code, { timeout: 15_000 })

      // The inline picker is a Radix Select. Open it and pick "30 days".
      await page.getByRole('combobox', { name: /All subscriptions|Expiring/i }).first().click()
      await page.getByRole('option', { name: /Expiring in 30 days/i }).click()

      // 30d window → Soon (5d) + Soonish (20d) visible, Later (60d) NOT.
      await expect(body).toContainText(subSoon.code, { timeout: 15_000 })
      await expect(body).toContainText(subSoonish.code, { timeout: 5_000 })
      await expect(body).not.toContainText(subLater.code)

      // Switch to 90 days → all three appear.
      await page.getByRole('combobox', { name: /Expiring in 30 days/i }).first().click()
      await page.getByRole('option', { name: /Expiring in 90 days/i }).click()
      await expect(body).toContainText(subLater.code, { timeout: 10_000 })
    } finally {
      await deleteSubscription(request, token, subSoon.id).catch(() => undefined)
      await deleteSubscription(request, token, subSoonish.id).catch(() => undefined)
      await deleteSubscription(request, token, subLater.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

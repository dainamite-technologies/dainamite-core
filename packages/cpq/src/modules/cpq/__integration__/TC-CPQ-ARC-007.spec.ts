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
 * TC-CPQ-ARC-007 — Renew from subscription detail (UI) (XD-250 scenario 3)
 *
 * The standalone /expiring page was retired (commit fa5b899) — the Renew
 * action moved onto the subscription detail page header. This test now
 * navigates straight to the expiring subscription's detail and clicks
 * Renew there. The "expiring" angle is preserved by seeding with
 * currentTermEnd inside the 30d window so the sub would have appeared on
 * the deprecated view; the renewal flow is identical regardless.
 */
test.describe('TC-CPQ-ARC-007 — Renew from subscription detail (UI)', () => {
  test('Renew on an expiring sub creates a RENEW quote with the source as the only target', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const sub = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Expiring Soon — for renew',
      currentTermEnd: daysFromNow(20),
    })

    try {
      await login(page, 'admin')
      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)

      // Subscription detail loads — its name is visible in the header.
      await expect(page.locator('body')).toContainText(sub.name, { timeout: 15_000 })

      // Click the Renew button in the FormHeader actions row.
      await page.getByRole('button', { name: /^Renew$/ }).first().click()

      // After click, startArcQuote('renew') POSTs from-subscription then
      // router.push()es to the new quote. Wait for URL transition.
      await page.waitForURL(/\/backend\/cpq\/quotes\/[0-9a-f-]+$/, { timeout: 15_000 })
      await expect(page.locator('body')).toContainText(sub.code, { timeout: 10_000 })
      // ARC banner shows "RENEW • 1 target: <code>" — DOM stores lowercase
      // 'renew' under a CSS uppercase rule, so `getByText` regex must use the
      // case-insensitive flag.
      await expect(page.getByText(/1 target/i).first()).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText(/renew/i).first()).toBeVisible({ timeout: 5_000 })
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

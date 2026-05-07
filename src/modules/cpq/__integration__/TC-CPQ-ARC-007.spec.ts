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
 * TC-CPQ-ARC-007 — Standalone renew from Expiring view (UI) (XD-250 scenario 3)
 *
 * Operator opens /backend/cpq/inventory/subscriptions/expiring, clicks the
 * Renew button on a sub whose currentTermEnd lands inside the default 30d
 * window, gets redirected to the new RENEW quote with the source attached.
 */
test.describe('TC-CPQ-ARC-007 — Renew from Expiring view (UI)', () => {
  test('Renew button on an expiring sub creates a RENEW quote with the source as the only target', async ({
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
      await page.goto('/backend/cpq/inventory/subscriptions/expiring', {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)

      // Sub is within default 30d window, so its row + Renew button render.
      await expect(page.locator('body')).toContainText(sub.code, { timeout: 15_000 })
      const subRow = page.getByRole('row', { name: new RegExp(sub.code) })
      await subRow.getByRole('button', { name: /^Renew$/ }).click()

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

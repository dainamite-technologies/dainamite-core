import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  seedSubscriptionInStatus,
  seedCustomer,
  deleteSubscription,
  deleteCustomer,
  hideFloatingOverlays,
} from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-ARC-008 — ARC on suspended subscription (UI) (XD-250 scenario 6, DD-ARC)
 *
 * Spec § DD-ARC: amend / standalone-renew / cancel work on suspended subs
 * without first reactivating. The action row in the subscription detail
 * header MUST render for status ∈ {active, suspended} — only terminal
 * statuses hide it. This test seeds a suspended sub, asserts the buttons
 * are rendered, opens Amend, and verifies the resulting quote attaches the
 * suspended sub as a target.
 */
test.describe('TC-CPQ-ARC-008 — ARC on suspended subscription (UI)', () => {
  test('suspended sub still shows ARC buttons; Amend works and quote attaches it', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const sub = await seedSubscriptionInStatus(
      request,
      token,
      { customerId, name: 'Suspended sub for ARC' },
      'suspended',
    )

    try {
      await login(page, 'admin')
      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)

      // Status badge confirms suspended; all three ARC buttons must render.
      await expect(page.locator('body')).toContainText(/suspended/i, { timeout: 15_000 })
      const amendBtn = page.getByRole('button', { name: /^Amend$/ })
      const renewBtn = page.getByRole('button', { name: /^Renew$/ })
      const cancelBtn = page.getByRole('button', { name: /^Cancel$/ })
      await expect(amendBtn).toBeVisible()
      await expect(renewBtn).toBeVisible()
      await expect(cancelBtn).toBeVisible()

      // Click Amend → fresh quote with the suspended sub as target.
      await amendBtn.click()
      await page.waitForURL(/\/backend\/cpq\/quotes\/[0-9a-f-]+$/, { timeout: 15_000 })
      await expect(page.locator('body')).toContainText(sub.code, { timeout: 10_000 })
      await expect(page.getByText(/1 target/i).first()).toBeVisible({ timeout: 5_000 })
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

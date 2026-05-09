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
 * TC-CPQ-ARC-006 — Concurrent ARC quote rejection + redirect-on-confirm (UI) (XD-250)
 *
 * Operator opens Amend on subscription S → quote Q1 created. While Q1 is
 * still in non-terminal status, the operator returns to S and clicks "Amend"
 * again. The second attempt is rejected server-side (409); the UI surfaces
 * the conflict via a window.confirm() carrying the 409 message and offers
 * to navigate to the existing quote. Spec § UI Integration "Existing-quote
 * redirect": clicking OK navigates to the conflicting Q1.
 */
test.describe('TC-CPQ-ARC-006 — Concurrent ARC rejection + redirect (UI)', () => {
  test('second Amend on a subscription already on a non-terminal ARC quote prompts and redirects to it', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const sub = await seedActiveSubscription(request, token, { customerId, name: 'Conflict Sub' })

    try {
      await login(page, 'admin')

      // 1st Amend — succeeds. Capture the resulting quote URL so we can
      // assert the redirect lands on the same one. We must wait for the URL
      // to actually change to /backend/cpq/quotes/<...> before snapshotting
      // it — body-text assertions can pass on the source subscription page
      // (which also contains sub.code) before router.push() completes.
      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)
      await page.getByRole('button', { name: /^Amend$/ }).click()
      await page.waitForURL(/\/backend\/cpq\/quotes\/[0-9a-f-]+$/, { timeout: 15_000 })
      await expect(page.locator('body')).toContainText(sub.code, { timeout: 10_000 })
      const firstQuoteUrl = new URL(page.url())
      const firstQuoteId = firstQuoteUrl.pathname.split('/').pop()
      expect(firstQuoteId).toBeTruthy()

      // 2nd Amend on the same sub — should trigger window.confirm() with
      // the conflict message + an offer to open the existing quote.
      // Accept the dialog → page should navigate back to the first quote.
      let confirmMessage: string | null = null
      page.once('dialog', async (dialog) => {
        confirmMessage = dialog.message()
        // Click OK → component should router.push(/backend/cpq/quotes/<existingId>).
        await dialog.accept()
      })

      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)
      await page.getByRole('button', { name: /^Amend$/ }).click()

      // Wait for the confirm to have surfaced.
      await expect.poll(() => confirmMessage, { timeout: 10_000 }).not.toBeNull()
      expect(confirmMessage).toMatch(/in progress|already|existing/i)
      // And the message should include an "Open the existing quote" prompt.
      expect(confirmMessage).toMatch(/Open the existing quote/i)

      // After accepting the confirm, the page should land on the first quote.
      await expect.poll(() => page.url(), { timeout: 10_000 }).toContain(firstQuoteId!)
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

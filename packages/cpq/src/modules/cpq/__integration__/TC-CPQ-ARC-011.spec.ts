import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  seedActiveSubscription,
  seedCustomer,
  deleteSubscription,
  deleteCustomer,
  hideFloatingOverlays,
} from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-ARC-011 — Full ARC lifecycle: amend → approval → convert → activate (UI + API hybrid)
 * (XD-250 scenario 11)
 *
 * The longest manual scenario: an amend quote is driven through the full
 * approval ladder, converted to an order, and activated. Activation runs
 * `cpqInventoryService.applyAmendment()` which writes a `CpqSubscriptionChangeLog`
 * row + emits `cpq.subscription.amended`. We assert UI at the entry points
 * (Amend button on the sub, Activate button on the order — renamed in
 * commit 720db2b) and at the exit (Change History (2) on the source sub:
 * one seeded `Created` row + one `Amended` row from the activation) and
 * drive the approval lifecycle / convert via API to keep the test stable.
 */
test.describe('TC-CPQ-ARC-011 — Full ARC lifecycle (UI + API hybrid)', () => {
  test('amend → drive through statuses → convert → activate → Change History (Created + Amended)', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const sub = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Lifecycle target',
      items: [{ name: 'Premium Tier', mrcAmount: 250 }],
    })

    try {
      await login(page, 'admin')

      // 1. UI — click Amend on the source sub. Captures the new quote id.
      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)
      await page.getByRole('button', { name: /^Amend$/ }).click()
      await page.waitForURL(/\/backend\/cpq\/quotes\/[0-9a-f-]+$/, { timeout: 15_000 })
      const quoteId = page.url().split('/').pop()!
      expect(quoteId).toMatch(/^[0-9a-f-]+$/)

      // 2. API — drive quote through approval ladder. The API path was
      // exercised manually for each transition; we just need an `accepted`
      // quote so Convert to Order unlocks.
      const transitions = [
        'ready',
        'in_approval',
        'approved',
        'with_customer',
        'accepted',
      ]
      for (const target of transitions) {
        const res = await apiRequest(
          request,
          'POST',
          `/api/cpq/quotes/${quoteId}/status`,
          { token, data: { targetStatus: target } },
        )
        expect(
          res.ok(),
          `transition to ${target} returned ${res.status()}: ${await res.text()}`,
        ).toBeTruthy()
      }

      // 3. API — convert quote to order. POST /api/cpq/orders with quoteId.
      const convertRes = await apiRequest(request, 'POST', '/api/cpq/orders', {
        token,
        data: { quoteId },
      })
      expect(
        convertRes.ok(),
        `convert returned ${convertRes.status()}: ${await convertRes.text()}`,
      ).toBeTruthy()
      const order = (await convertRes.json()) as { id: string }
      expect(order.id).toBeTruthy()

      // 4. UI — open the order detail and click Activate Order. This is the
      // critical mutation point: the API endpoint creates ChangeLog rows /
      // updates the subscription, but the manual instructs operators to
      // press the green button so we cover the same path here.
      await page.goto(`/backend/cpq/orders/${order.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)
      // Button renamed to "Activate" in commit 720db2b (entity context is
      // already in the FormHeader eyebrow, so the verb stands alone).
      const activateBtn = page.getByRole('button', { name: /^Activate$/ })
      await expect(activateBtn).toBeVisible({ timeout: 15_000 })
      await activateBtn.click()

      // Wait for activation to complete — order status flips to 'active' and
      // the green success banner appears.
      await expect(page.locator('body')).toContainText(/active/i, { timeout: 30_000 })

      // 5. UI — return to the source sub. Expect Change History (2):
      //    - the seeded `Created` row (commit fa5b899)
      //    - the `Amended` row written by activation
      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)
      const heading = page.getByRole('heading', { name: /Change History/i })
      await expect(heading).toBeVisible({ timeout: 15_000 })
      // Poll the count text — the change-log fetch is async and can race
      // with the heading's first paint.
      await expect.poll(async () => (await heading.textContent()) ?? '', {
        timeout: 15_000,
      }).toMatch(/\(2\)/)
      // Scope tag lookups to the Change History container so the
      // "Created" tag isn't confused with the meta-card "Created" label.
      const historySection = page.locator('div', { has: heading }).first()
      await expect(historySection.getByText(/^Amended$/).first()).toBeVisible({ timeout: 5_000 })
      await expect(historySection.getByText(/^Created$/).first()).toBeVisible({ timeout: 5_000 })
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

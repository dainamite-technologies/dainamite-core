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
 * TC-CPQ-ARC-009 — Terminal-status subscriptions hide ARC buttons (UI) (XD-250 scenario 7)
 *
 * Spec § UI Integration: the action row only renders when status ∈
 * {active, suspended}. Terminal statuses (`expired`, `terminated`,
 * `superseded`) MUST NOT show Amend / Renew / Cancel buttons. This test
 * verifies the gate for both `terminated` and `expired`.
 */
test.describe('TC-CPQ-ARC-009 — Terminal-status subs hide ARC buttons (UI)', () => {
  for (const status of ['terminated', 'expired'] as const) {
    test(`${status} sub renders status badge but no ARC action buttons`, async ({
      page,
      request,
    }) => {
      const token = await getAuthToken(request, 'admin')
      const customerId = await seedCustomer(request, token)
      const sub = await seedSubscriptionInStatus(
        request,
        token,
        { customerId, name: `${status} sub for ARC gate` },
        status,
      )

      try {
        await login(page, 'admin')
        await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
          waitUntil: 'domcontentloaded',
        })
        await hideFloatingOverlays(page)

        await expect(page.locator('body')).toContainText(new RegExp(status, 'i'), {
          timeout: 15_000,
        })

        // ARC buttons must not be present.
        await expect(page.getByRole('button', { name: /^Amend$/ })).toHaveCount(0)
        await expect(page.getByRole('button', { name: /^Renew$/ })).toHaveCount(0)
        // Note: there is a "Cancel" item-detail button elsewhere, but the
        // header-level Cancel ARC button is what we're guarding against.
        // Anchor by parent role — the action row sits inside the page
        // header, while item-row Cancels live inside item cards.
        const headerCancelButtons = page.locator('header, [role="banner"]')
          .getByRole('button', { name: /^Cancel$/ })
        await expect(headerCancelButtons).toHaveCount(0)
      } finally {
        await deleteSubscription(request, token, sub.id).catch(() => undefined)
        await deleteCustomer(request, token, customerId).catch(() => undefined)
      }
    })
  }
})

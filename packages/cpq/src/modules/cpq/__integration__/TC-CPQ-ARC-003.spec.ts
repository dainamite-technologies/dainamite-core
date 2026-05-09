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
 * TC-CPQ-ARC-003 — Merge renewal (UI) (XD-250)
 *
 * Operator starts a Renew quote on subscription A (becomes the first target,
 * standalone). They open the drawer, attach 2 more subs (B + C). The drawer
 * automatically flips to merge mode. They fill in the new contract term,
 * submit. Banner shows "Merging into a new contract" + 3 targets.
 */
test.describe('TC-CPQ-ARC-003 — Merge renewal (UI)', () => {
  test('attaching ≥2 renew targets enters merge mode and the banner shows the merge marker', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const subA = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Sub Alpha',
      billingCycle: 'monthly',
    })
    const subB = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Sub Bravo',
      billingCycle: 'monthly',
    })
    const subC = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Sub Charlie',
      billingCycle: 'monthly',
    })

    try {
      await login(page, 'admin')

      // Start a Renew quote on subA.
      await page.goto(`/backend/cpq/inventory/subscriptions/${subA.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)
      await page.getByRole('button', { name: /^Renew$/ }).click()
      await expect(page.locator('body')).toContainText(subA.code, { timeout: 15_000 })
      await hideFloatingOverlays(page)

      // Open drawer, attach subB + subC. The drawer auto-flips to merge mode
      // when 2+ renew targets are picked.
      await page.getByRole('button', { name: /Modify subscription/i }).click()
      await hideFloatingOverlays(page)
      const drawer = page.getByRole('dialog')

      const subBLabel = drawer.locator('label', { hasText: subB.code }).first()
      await expect(subBLabel).toBeVisible({ timeout: 10_000 })
      await subBLabel.locator('input[type="checkbox"]').check()

      const subCLabel = drawer.locator('label', { hasText: subC.code }).first()
      await subCLabel.locator('input[type="checkbox"]').check()

      // Merge banner inside drawer pick-targets step.
      await expect(
        drawer.getByText(/Merging \d+ contracts into a new one/i),
      ).toBeVisible({ timeout: 5_000 })

      // Next → config-renew (merge form).
      await drawer.getByRole('button', { name: /^Next$/ }).click()

      // Fill quote-level merge term.
      const startDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]
      const endDate = new Date(Date.now() + 395 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]

      // Drawer renders 3 date/number inputs labelled Start / End / Months for
      // the merge form. Scope to drawer to avoid any other date inputs on the
      // host page.
      const dateInputs = drawer.locator('input[type="date"]')
      await dateInputs.nth(0).fill(startDate)
      await dateInputs.nth(1).fill(endDate)

      await drawer.getByRole('button', { name: /^Next$/ }).click()
      await drawer.getByRole('button', { name: /^Submit$/ }).click()
      await drawer.getByRole('button', { name: /^Close$/ }).click()

      // Host page banner now reflects merge mode + 3 targets.
      await expect(page.getByText(/3 targets/i)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(/Merging into a new contract/i)).toBeVisible({
        timeout: 5_000,
      })
    } finally {
      await deleteSubscription(request, token, subA.id).catch(() => undefined)
      await deleteSubscription(request, token, subB.id).catch(() => undefined)
      await deleteSubscription(request, token, subC.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

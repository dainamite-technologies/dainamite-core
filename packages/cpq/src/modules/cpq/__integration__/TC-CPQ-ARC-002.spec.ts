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
 * TC-CPQ-ARC-002 — Multi-target Amend (UI) (XD-250)
 *
 * Operator starts an Amend quote on subscription A, opens the "Modify
 * subscription" drawer, attaches subscription B as a 2nd target. The ARC
 * banner then shows "2 targets".
 */
test.describe('TC-CPQ-ARC-002 — Multi-target Amend (UI)', () => {
  test('attaching a 2nd target via the drawer shows "2 targets" in the ARC banner', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const subA = await seedActiveSubscription(request, token, { customerId, name: 'Sub A' })
    const subB = await seedActiveSubscription(request, token, { customerId, name: 'Sub B' })

    try {
      await login(page, 'admin')

      // Open Amend on sub A — quote pre-filled with A as the target.
      await page.goto(`/backend/cpq/inventory/subscriptions/${subA.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)
      await page.getByRole('button', { name: /^Amend$/ }).click()
      await expect(page.locator('body')).toContainText(subA.code, { timeout: 15_000 })
      await hideFloatingOverlays(page)

      // Open the configurator drawer.
      await page.getByRole('button', { name: /Modify subscription/i }).click()
      await hideFloatingOverlays(page)
      const drawer = page.getByRole('dialog')

      // Drawer opens at "pick-targets" because quote_type is already 'amend'.
      // Pre-existing target (subA) is checked; subB row is unchecked. Tick subB.
      const subBLabel = drawer.locator('label', { hasText: subB.code }).first()
      await expect(subBLabel).toBeVisible({ timeout: 10_000 })
      await subBLabel.locator('input[type="checkbox"]').check()

      // Drawer step machine: Next → review → Submit.
      await drawer.getByRole('button', { name: /^Next$/ }).click()
      await drawer.getByRole('button', { name: /^Submit$/ }).click()

      // After submit, drawer reaches 'done'. Close returns to host quote page.
      await drawer.getByRole('button', { name: /^Close$/ }).click()
      await expect(page.getByText(/2 targets/i)).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteSubscription(request, token, subA.id).catch(() => undefined)
      await deleteSubscription(request, token, subB.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

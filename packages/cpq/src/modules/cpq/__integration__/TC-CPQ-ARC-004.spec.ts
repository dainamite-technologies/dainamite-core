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
 * TC-CPQ-ARC-004 — Cancel quote with reason + ETF (UI) (XD-250)
 *
 * Operator opens an active subscription, clicks "Cancel", drawer pre-fills
 * with the source sub as the cancel target. They open the configurator drawer
 * to stamp reason + ETF, submit. The ARC banner shows type=cancel.
 */
test.describe('TC-CPQ-ARC-004 — Cancel quote (UI)', () => {
  test('Cancel button creates a cancel quote, drawer stamps reason + ETF, banner shows CANCEL', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const sub = await seedActiveSubscription(request, token, { customerId, name: 'To Cancel' })

    try {
      await login(page, 'admin')

      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await hideFloatingOverlays(page)
      await page.getByRole('button', { name: /^Cancel$/ }).click()
      await expect(page.locator('body')).toContainText(sub.code, { timeout: 15_000 })
      await hideFloatingOverlays(page)

      // The new quote has quote_type='cancel'. Banner should show CANCEL.
      await expect(page.getByText('CANCEL', { exact: false }).first()).toBeVisible({
        timeout: 10_000,
      })

      // Open drawer to stamp cancel-meta.
      await page.getByRole('button', { name: /Modify subscription/i }).click()
      await hideFloatingOverlays(page)

      // initialType is 'cancel', so drawer skips pick-action and starts at
      // pick-targets. Sub is already attached. Next → config-cancel.
      const drawer = page.getByRole('dialog')
      await drawer.getByRole('button', { name: /^Next$/ }).click()

      // Reason code dropdown — scope to drawer to avoid the global org combobox.
      await drawer.locator('select').first().selectOption('non-payment')

      // Cancel-meta inputs in drawer order: reasonText, etfAmount, etfCurrency.
      // We only need to set the ETF amount.
      const drawerTextInputs = drawer.locator('input[type="text"]')
      await drawerTextInputs.nth(1).fill('500.00')

      await drawer.getByRole('button', { name: /^Next$/ }).click()
      await drawer.getByRole('button', { name: /^Submit$/ }).click()
      await drawer.getByRole('button', { name: /^Close$/ }).click()

      // After submit, the banner still shows CANCEL.
      await expect(page.getByText('CANCEL', { exact: false }).first()).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

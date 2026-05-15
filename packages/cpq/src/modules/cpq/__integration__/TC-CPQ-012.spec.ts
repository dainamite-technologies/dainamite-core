import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-CPQ-012 — Inline "Expiring within N days" picker smoke (UI)
 *
 * Commit `0992f60` / `071568d` replaced the retired `/expiring` page with
 * an inline picker on the main subscriptions list, mounted in the
 * DataTable title row. This test is a focused smoke check that the
 * picker is present, defaults to "All subscriptions", and can be opened
 * to reveal the canonical preset windows (7 / 14 / 30 / 60 / 90 days).
 *
 * Heavier data-level coverage (seeded subs, before/after window swap)
 * lives in TC-CPQ-ARC-005 — this spec stays small so it catches
 * "picker disappeared" regressions in seconds.
 */
test.describe('TC-CPQ-012: Inline expiring picker (UI)', () => {
  test('picker renders in title row with the 5 preset windows', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/cpq/inventory', { waitUntil: 'domcontentloaded' })

    // The picker is a Radix Select; trigger exposes role=combobox.
    // Default value is the "all" sentinel, rendered as "All subscriptions".
    const picker = page.getByRole('combobox', { name: /All subscriptions/i })
    await expect(picker).toBeVisible({ timeout: 15_000 })

    // Open the dropdown and verify the 5 canonical preset windows are
    // listed in the same order the operator's renewal-watch UX expects.
    await picker.click()
    for (const days of [7, 14, 30, 60, 90]) {
      await expect(
        page.getByRole('option', { name: new RegExp(`Expiring in ${days} days`, 'i') }),
      ).toBeVisible({ timeout: 5_000 })
    }
  })

  test('selecting a window updates the picker label without leaving the page', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/cpq/inventory', { waitUntil: 'domcontentloaded' })

    const trigger = page.getByRole('combobox', { name: /All subscriptions/i })
    await trigger.click()
    await page.getByRole('option', { name: /Expiring in 30 days/i }).click()

    // Same URL — the picker writes into the in-page filter state, not a
    // route param. Picker now reflects the chosen window.
    expect(page.url()).toContain('/backend/cpq/inventory')
    await expect(page.getByRole('combobox', { name: /Expiring in 30 days/i })).toBeVisible({
      timeout: 5_000,
    })
  })
})

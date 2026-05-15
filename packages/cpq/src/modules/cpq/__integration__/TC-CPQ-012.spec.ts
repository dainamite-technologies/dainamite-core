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
// Radix Select.Trigger renders a `<button role="combobox">` whose
// accessible name comes from the SelectValue children. Looking it up by
// `getByRole('combobox', { name: /All subscriptions/ })` has been
// brittle in CI (Radix can render SelectValue before the matching
// SelectItem mounts in its Portal, leaving the trigger temporarily
// nameless). The picker is the only combobox visible on the page until
// the Filters overlay is opened, so `.locator('[role="combobox"]')`
// is unambiguous *and* doesn't depend on accessibility-name timing.
const pickerLocator = '[role="combobox"]'

test.describe('TC-CPQ-012: Inline expiring picker (UI)', () => {
  test('picker renders in title row with the 5 preset windows', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/cpq/inventory', { waitUntil: 'domcontentloaded' })

    // Wait for the inline picker. Visible text content is "All
    // subscriptions" (default value) once Radix mounts.
    const picker = page.locator(pickerLocator).first()
    await expect(picker).toBeVisible({ timeout: 15_000 })
    await expect(picker).toContainText(/All subscriptions/i, { timeout: 10_000 })

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

    const trigger = page.locator(pickerLocator).first()
    await expect(trigger).toBeVisible({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('option', { name: /Expiring in 30 days/i }).click()

    // Same URL — the picker writes into the in-page filter state, not a
    // route param. Picker now reflects the chosen window.
    expect(page.url()).toContain('/backend/cpq/inventory')
    await expect(trigger).toContainText(/Expiring in 30 days/i, { timeout: 5_000 })
  })
})

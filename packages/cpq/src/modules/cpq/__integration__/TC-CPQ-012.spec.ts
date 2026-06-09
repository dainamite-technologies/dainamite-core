import { test, expect, type Locator } from '@playwright/test'
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

/**
 * Open the Radix Select and wait until its options have mounted.
 *
 * The single `trigger.click()` was the flake source in CI: Radix can
 * swallow the first click (the trigger isn't interactive yet on a slow
 * cold render) or open-then-close the menu under load, so the option list
 * never mounts and the following `toBeVisible` times out. Retrying the open
 * until a known option is visible makes the step deterministic.
 */
async function openExpiringPicker(trigger: Locator, probe: Locator): Promise<void> {
  await expect(async () => {
    await trigger.click()
    await expect(probe).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

test.describe('TC-CPQ-012: Inline expiring picker (UI)', () => {
  // Cold renders (login + goto + Radix mount) plus the open-retry budget can
  // exceed the 20s default; give these UI smokes explicit headroom so the
  // retry actually runs instead of being cut short by the test timeout.
  test.describe.configure({ timeout: 45_000 })

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
    await openExpiringPicker(picker, page.getByRole('option', { name: /Expiring in 30 days/i }))
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

    // Open the menu deterministically (retries the click until the option
    // mounts — see `openExpiringPicker`), then force the click to bypass
    // Radix's portal positioning layer that the default actionability check
    // treats as obscuring the option; Radix's own onSelect still fires.
    const option = page.getByRole('option', { name: /Expiring in 30 days/i })
    await openExpiringPicker(trigger, option)
    await option.click({ force: true })

    // Same URL — the picker writes into the in-page filter state, not a
    // route param. Picker now reflects the chosen window.
    expect(page.url()).toContain('/backend/cpq/inventory')
    await expect(trigger).toContainText(/Expiring in 30 days/i, { timeout: 5_000 })
  })
})

import { test, expect, type Locator, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  seedActiveSubscription,
  seedCustomer,
  daysFromNow,
  deleteSubscription,
  deleteCustomer,
  hideFloatingOverlays,
} from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-ARC-005 — Expiring Subscriptions filter (UI) (XD-250)
 *
 * The standalone `/expiring` page was retired (commit fa5b899) in favour
 * of an `expiringWithinDays` filter + saved-perspective workflow on the
 * main subscriptions list. This test now drives the inline expiring
 * picker that sits in the title row of the Subscriptions tab.
 *
 * Seeds 3 subscriptions with currentTermEnd at +5d / +20d / +60d.
 * Picking "Expiring in 30 days" shows the first two; switching to "90
 * days" reveals the third.
 */
/**
 * Open the picker and choose an option. Retried: a click that lands while
 * the table re-renders after the previous choice leaves the listbox closed.
 */
async function pickWindow(page: Page, picker: Locator, name: RegExp): Promise<void> {
  const option = page.getByRole('option', { name })
  await expect(async () => {
    if (!(await option.isVisible())) await picker.click()
    await option.click({ timeout: 2_000 })
    await expect(picker).toContainText(name, { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

test.describe('TC-CPQ-ARC-005 — Expiring view filter (UI)', () => {
  // Cleanup runs in afterEach so a timed-out test does not leave its
  // subscriptions behind (a `finally` in the test body never completes then).
  const cleanup: Array<() => Promise<unknown>> = []
  test.afterEach(async () => {
    for (const run of cleanup.splice(0).reverse()) await run().catch(() => undefined)
  })

  test('30-day window includes only subs with currentTermEnd within the window', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    cleanup.push(() => deleteCustomer(request, token, customerId))
    const subSoon = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Expiring Soon',
      currentTermEnd: daysFromNow(5),
    })
    const subSoonish = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Expiring Soonish',
      currentTermEnd: daysFromNow(20),
    })
    const subLater = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Expiring Later',
      currentTermEnd: daysFromNow(60),
    })

    for (const sub of [subSoon, subSoonish, subLater]) {
      cleanup.push(() => deleteSubscription(request, token, sub.id))
    }

    await login(page, 'admin')

    // Land on the Subscriptions tab of the main inventory page.
    await page.goto('/backend/cpq/inventory', { waitUntil: 'domcontentloaded' })
    await hideFloatingOverlays(page)

    // All three seeded subs initially visible (no window filter yet).
    const body = page.locator('body')
    await expect(body).toContainText(subSoon.code, { timeout: 15_000 })

    // The inline picker is a Radix Select.Trigger with role=combobox.
    // Accessibility-name matching is brittle (SelectValue can render
    // before its item mounts), so we target the trigger element
    // directly and rely on its visible text content for assertions.
    // Scoped to <main>: the header's organization switcher is also a
    // combobox, and once it renders a page-wide `.first()` resolves to it.
    const picker = page.getByRole('main').locator('[role="combobox"]').first()
    await expect(picker).toBeVisible({ timeout: 15_000 })

    // Open and pick "30 days".
    await pickWindow(page, picker, /Expiring in 30 days/i)

    // 30d window → Soon (5d) + Soonish (20d) visible, Later (60d) NOT.
    await expect(body).toContainText(subSoon.code, { timeout: 15_000 })
    await expect(body).toContainText(subSoonish.code, { timeout: 5_000 })
    await expect(body).not.toContainText(subLater.code)

    // Switch to 90 days → all three appear.
    await pickWindow(page, picker, /Expiring in 90 days/i)
    await expect(body).toContainText(subLater.code, { timeout: 10_000 })
  })
})

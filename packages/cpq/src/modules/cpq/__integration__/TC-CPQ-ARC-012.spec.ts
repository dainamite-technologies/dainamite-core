import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  seedActiveSubscription,
  seedCustomer,
  deleteSubscription,
  deleteCustomer,
  hideFloatingOverlays,
  uniq,
} from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-ARC-012 — Amend: removing an existing item cancels it on the subscription
 * (manual: xd-250-arc-flow.md → "Removing an existing item on Amend / Renew quotes")
 *
 * Deleting a line that mirrors a live subscription item must not drop the
 * line — activation only applies explicit line actions, so the item would
 * silently stay active. Instead a confirmation dialog explains the effect,
 * the line becomes a greyed-out `remove` line, the ARC summary keeps it in
 * Current MRC but not in New MRC, and Restore brings it back. After
 * convert + activate, the removed item is terminated and the kept one stays.
 */

type QuoteLine = { lineId: string; offeringName: string; action: string }
type SubscriptionItem = { id: string; name: string; status: string }

function lineRow(page: Page, name: string) {
  return page.getByTestId('cpq-quote-line').filter({ hasText: name })
}

test.describe('TC-CPQ-ARC-012 — Amend: remove an existing item', () => {
  test('confirm → remove line → MRC delta → restore → remove → activate terminates the item', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await seedCustomer(request, token)
    const keptName = `Kept Port ${uniq()}`
    const removedName = `Removed Storage ${uniq()}`
    const sub = await seedActiveSubscription(request, token, {
      customerId,
      name: 'Remove-item target',
      items: [
        { name: keptName, mrcAmount: 250 },
        { name: removedName, mrcAmount: 100 },
      ],
    })

    try {
      await login(page, 'admin')

      // 1. Amend from the subscription.
      await page.goto(`/backend/cpq/inventory/subscriptions/${sub.id}`, { waitUntil: 'domcontentloaded' })
      await hideFloatingOverlays(page)
      await page.getByRole('button', { name: /^Amend$/ }).click()
      await page.waitForURL(/\/backend\/cpq\/quotes\/[0-9a-f-]+$/, { timeout: 15_000 })
      const quoteId = page.url().split('/').pop()!
      await hideFloatingOverlays(page)

      const removedRow = lineRow(page, removedName)
      await expect(removedRow).toBeVisible()
      await expect(removedRow).not.toHaveAttribute('data-removed', 'true')

      // 2. Trash → confirmation dialog explains the item is cancelled. Cancel keeps the line.
      await removedRow.getByTitle('Remove').click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText(`Remove ${removedName} from the subscription?`)
      await expect(dialog).toContainText('cancelled on the subscription')
      await dialog.getByRole('button', { name: /^Cancel$/ }).click()
      await expect(dialog).toBeHidden()
      await expect(removedRow).not.toHaveAttribute('data-removed', 'true')

      // 3. Confirm → the line stays as a `remove` line with a Restore action.
      await removedRow.getByTitle('Remove').click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove item' }).click()
      await expect(removedRow).toHaveAttribute('data-removed', 'true')
      await expect(removedRow.getByText(/^remove$/)).toBeVisible()
      await expect(removedRow.getByTestId('cpq-line-restore')).toBeVisible()

      // 4. Summary: removed item stays in Current MRC, drops out of New MRC.
      await expect(page.getByTestId('cpq-arc-current-mrc')).toContainText('$350.00')
      await expect(page.getByTestId('cpq-arc-new-mrc')).toContainText('$250.00')
      await expect(page.getByTestId('cpq-arc-mrc-change')).toContainText('-$100.00')

      // 5. Restore → back to a normal line; totals back to unchanged.
      await removedRow.getByTestId('cpq-line-restore').click()
      await expect(removedRow).not.toHaveAttribute('data-removed', 'true')
      await expect(page.getByTestId('cpq-arc-new-mrc')).toContainText('$350.00')

      // 6. Remove again for the activation leg.
      await removedRow.getByTitle('Remove').click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove item' }).click()
      await expect(removedRow).toHaveAttribute('data-removed', 'true')

      // The API agrees: one cancel line, one modify line.
      const quoteRes = await apiRequest(request, 'GET', `/api/cpq/quotes/${quoteId}`, { token })
      expect(quoteRes.ok()).toBeTruthy()
      const quote = (await quoteRes.json()) as { cpqStatus: string; lines: QuoteLine[] }
      expect(quote.lines.find((l) => l.offeringName === removedName)?.action).toBe('cancel')
      expect(quote.lines.find((l) => l.offeringName === keptName)?.action).toBe('modify')

      // 7. API — approval ladder (from wherever recalculation left the quote), convert, activate.
      const ladder = ['ready', 'in_approval', 'approved', 'with_customer', 'accepted']
      for (const targetStatus of ladder.slice(ladder.indexOf(quote.cpqStatus) + 1)) {
        const res = await apiRequest(request, 'POST', `/api/cpq/quotes/${quoteId}/status`, { token, data: { targetStatus } })
        expect(res.ok(), `transition to ${targetStatus} returned ${res.status()}: ${await res.text()}`).toBeTruthy()
      }
      const convertRes = await apiRequest(request, 'POST', '/api/cpq/orders', { token, data: { quoteId } })
      expect(convertRes.ok(), `convert returned ${convertRes.status()}: ${await convertRes.text()}`).toBeTruthy()
      const order = (await convertRes.json()) as { id: string }

      // The order page mirrors the quote: same ARC summary, removed line marked "remove".
      await page.goto(`/backend/cpq/orders/${order.id}`, { waitUntil: 'domcontentloaded' })
      await hideFloatingOverlays(page)
      await expect(page.getByTestId('cpq-pricing-summary')).toBeVisible()
      await expect(page.getByTestId('cpq-arc-current-mrc')).toContainText('$350.00')
      await expect(page.getByTestId('cpq-arc-new-mrc')).toContainText('$250.00')
      const removedOrderLine = page.getByTestId('cpq-order-line').filter({ hasText: removedName })
      await expect(removedOrderLine).toHaveAttribute('data-removed', 'true')
      await expect(removedOrderLine.getByText(/^remove$/)).toBeVisible()
      const activateRes = await apiRequest(request, 'POST', `/api/cpq/orders/${order.id}/activate`, { token })
      expect(activateRes.ok(), `activate returned ${activateRes.status()}: ${await activateRes.text()}`).toBeTruthy()

      // 8. The removed item is terminated; the other one is untouched.
      const itemsRes = await apiRequest(request, 'GET', `/api/cpq/inventory/subscription-items?subscriptionId=${sub.id}`, { token })
      expect(itemsRes.ok()).toBeTruthy()
      const body = (await itemsRes.json()) as SubscriptionItem[] | { items: SubscriptionItem[] }
      const items = Array.isArray(body) ? body : body.items
      expect(items.find((i) => i.name === removedName)?.status).toBe('terminated')
      expect(items.find((i) => i.name === keptName)?.status).toBe('active')
    } finally {
      await deleteSubscription(request, token, sub.id).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
    }
  })
})

import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCustomer, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-ARC-014: an item dropped at renewal stops billing (API).
 *
 * 1. Sell two recurring services and activate: billing creates one recurring
 *    Billing Item per service.
 * 2. Renew the subscription and remove the add-on line (`cancel`).
 * 3. At activation the add-on's Billing Item ends the day before the new term
 *    starts; the kept service keeps billing.
 */

type Json = Record<string, unknown>
type Line = { lineId: string; offeringId: string | null; action: string }
type Quote = { id: string; cpqStatus: string; lines: Line[] }
type Item = { id: string; offeringId: string | null; children?: Item[] }
type BillingItem = { subscriptionItemId: string | null; billEndDate: string | null; type: string }

const flatten = (items: Item[]): Item[] => items.flatMap((item) => [item, ...flatten(item.children ?? [])])

const LADDER = ['ready', 'in_approval', 'approved', 'with_customer', 'accepted']

async function call(request: APIRequestContext, token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: Json) {
  const res = await apiRequest(request, method, path, { token, ...(data ? { data } : {}) })
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Json }
}

async function created(request: APIRequestContext, token: string, path: string, data: Json): Promise<string> {
  const res = await call(request, token, 'POST', path, data)
  expect(res.status, `POST ${path}: ${JSON.stringify(res.body)}`).toBe(201)
  return res.body.id as string
}

async function toOrderAndActivate(request: APIRequestContext, token: string, quoteId: string): Promise<void> {
  const current = (await call(request, token, 'GET', `/api/cpq/quotes/${quoteId}`)).body.cpqStatus as string
  for (const targetStatus of LADDER.slice(LADDER.indexOf(current) + 1)) {
    const res = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/status`, { targetStatus })
    expect(res.status, `transition to ${targetStatus}: ${JSON.stringify(res.body)}`).toBeLessThan(300)
  }
  const order = await call(request, token, 'POST', '/api/cpq/orders', { quoteId })
  expect(order.status, `convert: ${JSON.stringify(order.body)}`).toBeLessThan(300)
  const activated = await call(request, token, 'POST', `/api/cpq/orders/${order.body.id}/activate`, {})
  expect(activated.status, `activate: ${JSON.stringify(activated.body)}`).toBeLessThan(300)
}

/** Billing list rows may come back snake_case; read both spellings. */
function toBillingItem(row: Json): BillingItem {
  return {
    subscriptionItemId: (row.subscriptionItemId ?? row.subscription_item_id ?? null) as string | null,
    billEndDate: ((row.billEndDate ?? row.bill_end_date ?? null) as string | null)?.slice(0, 10) ?? null,
    type: (row.type ?? '') as string,
  }
}

async function billingItems(request: APIRequestContext, token: string, subscriptionId: string): Promise<BillingItem[]> {
  const res = await call(request, token, 'GET', `/api/billing/items?subscriptionId=${subscriptionId}&pageSize=100`)
  return ((res.body.items ?? []) as Json[]).map(toBillingItem)
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

test.describe('TC-CPQ-ARC-014: renewal ends billing for removed items (API)', () => {
  const cleanup: Array<() => Promise<unknown>> = []
  test.afterAll(async () => {
    for (const run of cleanup.reverse()) await run().catch(() => undefined)
  })

  test('renew with a removed add-on end-dates its Billing Item', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const del = (path: string, id: string) => () => apiRequest(request, 'DELETE', path, { token, data: { id } })
    const tag = uniq()

    // ── Catalog: two recurring services ─────────────────────────────────
    const service = async (code: string, price: string) => {
      const specId = await created(request, token, '/api/cpq/product-specifications', { code: `ARC14-${code}-${tag}`, name: `ARC14 ${code}`, specType: 'simple', lifecycleStatus: 'active' })
      cleanup.push(del('/api/cpq/product-specifications', specId))
      const offeringId = await created(request, token, '/api/cpq/product-offerings', { specId, code: `ARC14-OFF-${code}-${tag}`, name: `ARC14 ${code}`, lifecycleStatus: 'active' })
      cleanup.push(del('/api/cpq/product-offerings', offeringId))
      await created(request, token, '/api/cpq/product-charges', {
        offeringId, code: `MRC-${code}-${tag}`, name: `${code} monthly`, chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'fixed', fixedPrice: price, currencyCode: 'USD',
      })
      return offeringId
    }
    const internet = await service('internet', '50')
    const addon = await service('addon', '10')

    // ── 1. Sell and activate ────────────────────────────────────────────
    const customerId = await seedCustomer(request, token, `ARC14-Co-${tag}`)
    cleanup.push(() => deleteCustomer(request, token, customerId))
    const quoteId = await created(request, token, '/api/cpq/quotes', { customerId, currencyCode: 'USD' })
    for (const offeringId of [internet, addon]) {
      const added = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/items`, { offeringId, configuration: {} })
      expect(added.status, JSON.stringify(added.body)).toBe(201)
    }
    await toOrderAndActivate(request, token, quoteId)

    const subs = await call(request, token, 'GET', `/api/cpq/inventory/subscriptions?customerId=${customerId}`)
    const subId = ((subs.body.items as Json[])[0] as Json).id as string
    expect(subId).toBeTruthy()
    const activate = await call(request, token, 'POST', '/api/cpq/inventory/subscriptions/status', { id: subId, targetStatus: 'active' })
    expect(activate.status, JSON.stringify(activate.body)).toBeLessThan(300)

    const items = flatten(((await call(request, token, 'GET', `/api/cpq/inventory/subscriptions?id=${subId}`)).body.items ?? []) as Item[])
    const internetItem = items.find((item) => item.offeringId === internet)!
    const addonItem = items.find((item) => item.offeringId === addon)!
    expect(internetItem && addonItem).toBeTruthy()

    await expect
      .poll(async () => (await billingItems(request, token, subId)).filter((bi) => bi.type === 'recurring').length, { timeout: 20_000 })
      .toBe(2)

    // ── 2. Renew, dropping the add-on ───────────────────────────────────
    const renew = await call(request, token, 'POST', '/api/cpq/quotes/from-subscription', { subscriptionId: subId, type: 'renew' })
    expect(renew.status, JSON.stringify(renew.body)).toBeLessThan(300)
    const renewId = renew.body.quoteId as string
    const renewQuote = (await call(request, token, 'GET', `/api/cpq/quotes/${renewId}`)).body as unknown as Quote
    const addonLine = renewQuote.lines.find((line) => line.offeringId === addon)!
    const removed = await call(request, token, 'DELETE', `/api/cpq/quotes/${renewId}/items/${addonLine.lineId}`)
    expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300)
    expect((removed.body as unknown as Quote).lines.find((line) => line.lineId === addonLine.lineId)?.action).toBe('cancel')
    await toOrderAndActivate(request, token, renewId)

    // ── 3. Billing: the add-on ends before the new term ─────────────────
    const sub = (await call(request, token, 'GET', `/api/cpq/inventory/subscriptions?id=${subId}`)).body as Json
    const newTermStart = String(sub.currentTermStart ?? sub.current_term_start ?? '')
    expect(newTermStart, JSON.stringify(sub).slice(0, 400)).toMatch(/^\d{4}-\d{2}-\d{2}/)

    await expect
      .poll(async () => (await billingItems(request, token, subId)).find((bi) => bi.subscriptionItemId === addonItem.id)?.billEndDate ?? null, { timeout: 20_000 })
      .toBe(dayBefore(newTermStart))
    const internetBilling = (await billingItems(request, token, subId)).find((bi) => bi.subscriptionItemId === internetItem.id)
    expect(internetBilling?.billEndDate ?? null).toBeNull()
  })
})

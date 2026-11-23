import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCustomer, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-ARC-013: devices (assets) on ARC quotes, issue #126 (API).
 *
 * 1. A bundle with an Internet service (MRC 50) and an assetizable ONT
 *    (NRC 99) is sold and activated. The ONT becomes an asset under the
 *    bundle item, not a subscription item, and the bundle item carries no
 *    service charges (no double counting).
 * 2. An Amend quote mirrors the ONT as a `modify` device line under the
 *    bundle, unpriced, so the CPE slot is filled and the quote MRC stays 50.
 * 3. The ONT line cannot be edited; it can be removed (cancel) and restored.
 *    Removing it and adding a new ONT swaps the device: at activation the old
 *    asset is `returned` and the new one is a pending asset under the bundle
 *    item, again with no extra subscription item.
 * 4. A Cancel quote lists the device as a `cancel` line; at activation the
 *    remaining device is retired with the subscription.
 */

type Json = Record<string, unknown>
type Line = {
  lineId: string
  offeringId: string | null
  parentLineId: string | null
  action: string
  nrcTotal: number
  mrcTotal: number
  configuration: Json | null
}
type Quote = { id: string; cpqStatus: string; lines: Line[]; pricingSummary?: { mrcTotal?: number } }
type Asset = { id: string; status: string; subscriptionItemId: string | null; offeringId: string | null }
type Item = { id: string; offeringId: string | null; parentItemId: string | null; mrcAmount: number; nrcAmount: number; status: string; children?: Item[] }

/** The subscription detail returns its items as a tree (`children`). */
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

const isDeviceLine = (line: Line) => typeof line.configuration?._arcMirroredFromAssetId === 'string'

test.describe('TC-CPQ-ARC-013: devices (assets) on ARC quotes (API)', () => {
  const cleanup: Array<() => Promise<unknown>> = []
  test.afterAll(async () => {
    for (const run of cleanup.reverse()) await run().catch(() => undefined)
  })

  test('sell, amend with a device swap, cancel', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const del = (path: string, id: string) => () => apiRequest(request, 'DELETE', path, { token, data: { id } })
    const tag = uniq()

    // ── Catalog ──────────────────────────────────────────────────────────
    const spec = (code: string, specType: 'simple' | 'bundle', extra: Json = {}) =>
      created(request, token, '/api/cpq/product-specifications', { code: `ARC13-${code}-${tag}`, name: `ARC13 ${code}`, specType, lifecycleStatus: 'active', ...extra })
    const internetSpec = await spec('internet', 'simple')
    const ontSpec = await spec('ont', 'simple', { isAssetizable: true })
    const bundleSpec = await spec('bundle', 'bundle')
    cleanup.push(del('/api/cpq/product-specifications', internetSpec), del('/api/cpq/product-specifications', ontSpec), del('/api/cpq/product-specifications', bundleSpec))

    const offering = (specId: string, code: string) =>
      created(request, token, '/api/cpq/product-offerings', { specId, code: `ARC13-OFF-${code}-${tag}`, name: `ARC13 ${code}`, lifecycleStatus: 'active' })
    const internet = await offering(internetSpec, 'internet')
    const ont = await offering(ontSpec, 'ont')
    const bundle = await offering(bundleSpec, 'bundle')
    cleanup.push(del('/api/cpq/product-offerings', internet), del('/api/cpq/product-offerings', ont), del('/api/cpq/product-offerings', bundle))

    await created(request, token, '/api/cpq/product-charges', {
      offeringId: internet, code: `MRC-${tag}`, name: 'Internet monthly', chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'fixed', fixedPrice: '50', currencyCode: 'USD',
    })
    await created(request, token, '/api/cpq/product-charges', {
      offeringId: ont, code: `NRC-${tag}`, name: 'ONT device', chargeType: 'nrc', chargeModel: 'flat', pricingMethod: 'fixed', fixedPrice: '99', currencyCode: 'USD',
    })

    const accessSlot = await created(request, token, '/api/cpq/bundle-slots', { specId: bundleSpec, targetSpecId: internetSpec, componentGroup: 'access', name: 'Access', cardinalityMin: 1, cardinalityMax: 1 })
    const cpeSlot = await created(request, token, '/api/cpq/bundle-slots', { specId: bundleSpec, targetSpecId: ontSpec, componentGroup: 'cpe', name: 'CPE', cardinalityMin: 1, cardinalityMax: 1 })
    await created(request, token, '/api/cpq/offering-components', { offeringId: bundle, slotId: accessSlot, childOfferingId: internet, isDefault: true })
    await created(request, token, '/api/cpq/offering-components', { offeringId: bundle, slotId: cpeSlot, childOfferingId: ont, isDefault: true })

    // ── 1. Sell and activate ────────────────────────────────────────────
    const customerId = await seedCustomer(request, token, `ARC13-Co-${tag}`)
    cleanup.push(() => deleteCustomer(request, token, customerId))
    const quoteId = await created(request, token, '/api/cpq/quotes', { customerId, currencyCode: 'USD' })
    const added = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/items`, { offeringId: bundle, configuration: {}, expandBundleDefaults: true })
    expect(added.status, JSON.stringify(added.body)).toBe(201)
    await toOrderAndActivate(request, token, quoteId)

    const subs = await call(request, token, 'GET', `/api/cpq/inventory/subscriptions?customerId=${customerId}`)
    const subId = ((subs.body.items as Json[])[0] as Json).id as string
    expect(subId).toBeTruthy()
    const activate = await call(request, token, 'POST', '/api/cpq/inventory/subscriptions/status', { id: subId, targetStatus: 'active' })
    expect(activate.status, JSON.stringify(activate.body)).toBeLessThan(300)

    const subDetail = await call(request, token, 'GET', `/api/cpq/inventory/subscriptions?id=${subId}`)
    const items = flatten((subDetail.body.items ?? []) as Item[])
    const bundleItem = items.find((item) => item.offeringId === bundle)!
    expect(items.map((item) => item.offeringId).sort()).toEqual([bundle, internet].sort()) // no ONT item
    expect(Number(bundleItem.mrcAmount)).toBe(0) // the bundle does not carry the service's charges
    const assetsAfterSale = (await call(request, token, 'GET', `/api/cpq/inventory/assets?subscriptionId=${subId}`)).body.items as Asset[]
    expect(assetsAfterSale).toHaveLength(1)
    const firstOnt = assetsAfterSale[0]
    expect(firstOnt).toMatchObject({ offeringId: ont, subscriptionItemId: bundleItem.id, status: 'active' })

    // ── 2. Amend mirrors the device ─────────────────────────────────────
    const amend = await call(request, token, 'POST', '/api/cpq/quotes/from-subscription', { subscriptionId: subId, type: 'amend' })
    expect(amend.status, JSON.stringify(amend.body)).toBeLessThan(300)
    const amendId = amend.body.quoteId as string
    let amendQuote = (await call(request, token, 'GET', `/api/cpq/quotes/${amendId}`)).body as unknown as Quote
    const bundleLine = amendQuote.lines.find((line) => line.offeringId === bundle)!
    const deviceLine = amendQuote.lines.find(isDeviceLine)!
    expect(deviceLine).toMatchObject({ offeringId: ont, parentLineId: bundleLine.lineId, action: 'modify', nrcTotal: 0, mrcTotal: 0 })
    expect(amendQuote.lines.filter((line) => line.offeringId === ont)).toHaveLength(1)

    // ── 3. Device line: no edit; remove, restore, swap ─────────────────
    const edit = await call(request, token, 'PUT', `/api/cpq/quotes/${amendId}/items/${deviceLine.lineId}`, { configuration: {}, quantity: 2 })
    expect(edit.status).toBe(409)

    const removed = await call(request, token, 'DELETE', `/api/cpq/quotes/${amendId}/items/${deviceLine.lineId}`)
    expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300)
    amendQuote = removed.body as unknown as Quote
    expect(amendQuote.lines.find((line) => line.lineId === deviceLine.lineId)?.action).toBe('cancel')

    const restored = await call(request, token, 'POST', `/api/cpq/quotes/${amendId}/items/${deviceLine.lineId}/restore`, {})
    expect(restored.status, JSON.stringify(restored.body)).toBeLessThan(300)
    expect((restored.body as unknown as Quote).lines.find((line) => line.lineId === deviceLine.lineId)?.action).toBe('modify')

    await call(request, token, 'DELETE', `/api/cpq/quotes/${amendId}/items/${deviceLine.lineId}`)
    const swap = await call(request, token, 'POST', `/api/cpq/quotes/${amendId}/items`, { offeringId: ont, configuration: {}, parentLineId: bundleLine.lineId })
    expect(swap.status, JSON.stringify(swap.body)).toBe(201)
    amendQuote = swap.body as unknown as Quote
    expect(amendQuote.cpqStatus).not.toBe('incomplete') // CPE slot: old device removed, new one added
    await toOrderAndActivate(request, token, amendId)

    const assetsAfterAmend = (await call(request, token, 'GET', `/api/cpq/inventory/assets?subscriptionId=${subId}`)).body.items as Asset[]
    expect(assetsAfterAmend.find((asset) => asset.id === firstOnt.id)?.status).toBe('returned')
    const newOnt = assetsAfterAmend.find((asset) => asset.id !== firstOnt.id)!
    expect(newOnt).toMatchObject({ offeringId: ont, subscriptionItemId: bundleItem.id, status: 'pending' })
    const itemsAfterAmend = flatten(((await call(request, token, 'GET', `/api/cpq/inventory/subscriptions?id=${subId}`)).body.items ?? []) as Item[])
    expect(itemsAfterAmend.filter((item) => item.offeringId === ont)).toHaveLength(0) // still no ONT item

    // ── 4. Cancel retires the device ────────────────────────────────────
    const cancel = await call(request, token, 'POST', '/api/cpq/quotes/from-subscription', { subscriptionId: subId, type: 'cancel' })
    expect(cancel.status, JSON.stringify(cancel.body)).toBeLessThan(300)
    const cancelId = cancel.body.quoteId as string
    const cancelQuote = (await call(request, token, 'GET', `/api/cpq/quotes/${cancelId}`)).body as unknown as Quote
    expect(cancelQuote.lines.find(isDeviceLine)).toMatchObject({ offeringId: ont, action: 'cancel' })
    const meta = await call(request, token, 'POST', `/api/cpq/quotes/${cancelId}/cancel-meta`, { reasonCode: 'customer-request' })
    expect(meta.status, JSON.stringify(meta.body)).toBeLessThan(300)
    await toOrderAndActivate(request, token, cancelId)

    const assetsAfterCancel = (await call(request, token, 'GET', `/api/cpq/inventory/assets?subscriptionId=${subId}`)).body.items as Asset[]
    expect(assetsAfterCancel.find((asset) => asset.id === newOnt.id)?.status).toBe('cancelled') // never delivered
    expect(assetsAfterCancel.find((asset) => asset.id === firstOnt.id)?.status).toBe('returned')
  })
})

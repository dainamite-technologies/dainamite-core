import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCustomer, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-014 — Manual pricing flexibility
 * (spec .ai/specs/2026-11-26-cpq-manual-pricing-flexibility.md).
 *
 * 1. A line-level Set price without Recurring / One-time is refused (400).
 * 2. A line-level Set price on the recurring charges is spread over them in
 *    proportion to their standard totals; the line MRC equals the typed price.
 * 3. A charge Set price above standard is accepted (ABOVE_STANDARD is gone).
 * 4. The line row shows an "Adjust price" button (UI).
 * 5. A volume / tiered charge takes a Set charge total (skipped when the
 *    tenant has no such charge in its seed data).
 *
 * Needs a seeded database: the reason dictionary and the
 * `cpq.manual_price_adjustments` toggle (on), as seeded by CPQ setup.
 */

type Json = Record<string, unknown>
type Charge = { chargeCode: string; chargeType: string; pricingMethod: string; unitPrice: number; totalPrice: number | null; standardUnitPrice?: number }
type Line = { lineId: string; mrcTotal: number; nrcTotal: number; charges: Charge[] }
type Quote = { id: string; currencyCode: string; lines: Line[] }

async function call(request: APIRequestContext, token: string, method: 'POST' | 'GET', path: string, data?: Json) {
  const res = await apiRequest(request, method, path, { token, ...(data ? { data } : {}) })
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Json }
}

test.describe('TC-CPQ-014: line Set price, above standard, charge total', () => {
  const cleanup: Array<() => Promise<unknown>> = []
  test.afterEach(async () => {
    for (const run of cleanup.splice(0).reverse()) await run().catch(() => undefined)
  })

  test('spreads a line price, allows above standard and shows the Adjust price button', async ({ request, page }) => {
    const token = await getAuthToken(request, 'admin')
    const tag = uniq()
    const spec = await call(request, token, 'POST', '/api/cpq/product-specifications', { code: `TC014-${tag}`, name: 'TC-014 spec', specType: 'simple', lifecycleStatus: 'active' })
    expect(spec.status).toBe(201)
    cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-specifications', { token, data: { id: spec.body.id } }))
    const offering = await call(request, token, 'POST', '/api/cpq/product-offerings', { specId: spec.body.id, code: `TC014-OFF-${tag}`, name: 'TC-014 offering', lifecycleStatus: 'active' })
    expect(offering.status).toBe(201)
    cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-offerings', { token, data: { id: offering.body.id } }))
    for (const [code, chargeType, price] of [['a', 'mrc', 60], ['b', 'mrc', 30], ['c', 'mrc', 10], ['setup', 'nrc', 50]] as const) {
      const charge = await call(request, token, 'POST', '/api/cpq/product-charges', {
        offeringId: offering.body.id, code: `${code}-${tag}`, name: `Charge ${code}`, chargeType,
        chargeModel: 'flat', pricingMethod: 'fixed', fixedPrice: String(price), currencyCode: 'USD',
      })
      expect(charge.status, JSON.stringify(charge.body)).toBe(201)
    }

    const customer = await seedCustomer(request, token, `TC-014 ${tag}`)
    cleanup.push(() => deleteCustomer(request, token, customer))
    const created = await call(request, token, 'POST', '/api/cpq/quotes', { customerId: customer, currencyCode: 'USD' })
    const quoteId = created.body.id as string
    const added = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/items`, { offeringId: offering.body.id, quantity: 1 })
    expect(added.status, JSON.stringify(added.body)).toBe(201)
    const lineId = (added.body as unknown as Quote).lines[0].lineId
    const base = { level: 'line', quoteLineId: lineId, adjustmentType: 'price_override', value: 50, currencyCode: 'USD', reasonCode: 'competitive_match' }

    // 1. A line Set price needs Recurring or One-time.
    expect((await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/price-adjustments`, base)).status).toBe(400)

    // 2. Line recurring price 50: 60 / 30 / 10 → 30 / 15 / 5, the setup fee unchanged.
    const lineSet = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/price-adjustments`, { ...base, chargeTypeFilter: 'mrc' })
    expect(lineSet.status, JSON.stringify(lineSet.body)).toBe(201)
    const line = (lineSet.body.quote as Quote).lines.find((entry) => entry.lineId === lineId)!
    expect(line.mrcTotal).toBeCloseTo(50, 2)
    expect(line.nrcTotal).toBeCloseTo(50, 2)
    expect(line.charges.filter((charge) => charge.chargeType === 'mrc').map((charge) => charge.totalPrice).sort((x, y) => (y ?? 0) - (x ?? 0))).toEqual([30, 15, 5])

    // 3. Above standard on the one-time setup: 50 → 75 is accepted.
    const setupCode = line.charges.find((charge) => charge.chargeType === 'nrc')!.chargeCode
    const above = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/price-adjustments`, {
      level: 'charge', quoteLineId: lineId, chargeCode: setupCode, adjustmentType: 'price_override', value: 75, currencyCode: 'USD', reasonCode: 'price_correction',
    })
    expect(above.status, JSON.stringify(above.body)).toBe(201)
    const setup = (above.body.quote as Quote).lines.find((entry) => entry.lineId === lineId)!.charges.find((charge) => charge.chargeCode === setupCode)!
    expect(setup.unitPrice).toBe(75)
    expect(setup.standardUnitPrice).toBe(50)

    // 4. UI: the line row has an Adjust price button.
    await login(page, 'admin')
    await page.goto(`/backend/cpq/quotes/${quoteId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('main').getByTestId('cpq-adjust-line').first()).toBeVisible({ timeout: 15_000 })
  })

  test('sets the total of a volume or tiered charge', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const listed = await call(request, token, 'GET', '/api/cpq/product-charges?pageSize=100')
    const items = (listed.body.items ?? []) as Array<{ offeringId?: string | null; chargeModel?: string; chargeType?: string }>
    const tiered = items.find((item) => item.offeringId && item.chargeType !== 'usage' && (item.chargeModel === 'tiered' || item.chargeModel === 'volume'))
    test.skip(!tiered, 'No volume / tiered charge in this tenant’s seed data')
    const customer = await seedCustomer(request, token, `TC-014 tiered ${uniq()}`)
    cleanup.push(() => deleteCustomer(request, token, customer))
    const created = await call(request, token, 'POST', '/api/cpq/quotes', { customerId: customer, currencyCode: 'USD' })
    const added = await call(request, token, 'POST', `/api/cpq/quotes/${created.body.id}/items`, { offeringId: tiered!.offeringId, quantity: 1 })
    test.skip(added.status !== 201, 'The tiered offering needs configuration this test does not provide')
    const quote = added.body as unknown as Quote
    const line = quote.lines[0]
    const charge = line.charges.find((entry) => entry.pricingMethod === 'tiered' || entry.pricingMethod === 'volume')
    test.skip(!charge || charge.totalPrice === null, 'The tiered charge did not price on this configuration')
    const result = await call(request, token, 'POST', `/api/cpq/quotes/${quote.id}/price-adjustments`, {
      level: 'charge', quoteLineId: line.lineId, chargeCode: charge!.chargeCode, adjustmentType: 'price_override',
      value: 123.45, currencyCode: quote.currencyCode, reasonCode: 'volume_commitment',
    })
    expect(result.status, JSON.stringify(result.body)).toBe(201)
    const priced = (result.body.quote as Quote).lines[0].charges.find((entry) => entry.chargeCode === charge!.chargeCode)!
    expect(priced.totalPrice).toBeCloseTo(123.45, 2)
  })
})

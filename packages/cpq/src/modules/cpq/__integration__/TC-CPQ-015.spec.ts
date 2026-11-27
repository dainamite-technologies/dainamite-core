import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCustomer, hideFloatingOverlays, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-015 — The quote's Price dialog and the target API
 * (spec .ai/specs/2026-11-27-cpq-billing-phases-ux-feedback.md, §9 Phase 2.6).
 *
 * 1. Recurring phases (Free trial → 50% off) and a one-time 20% off on the
 *    same line, each saved as one PUT …/price-adjustments/target; the panel
 *    shows one row per target with the author's name, not an id.
 * 2. A ramp 100 → 110 → 120 on a product listed at 100: Regular price 12
 *    months, Set price 110 for 12 months, then Set price 120 (above standard).
 * 3. The conflict message: "all charges 10% off" on a line with recurring
 *    phases is reported in the preview and Save stays disabled (UI).
 * 4. The order shows the source quote's adjustments, read-only.
 *
 * Needs a seeded database: the reason dictionary and the
 * `cpq.manual_price_adjustments` toggle (on), as seeded by CPQ setup.
 */

type Json = Record<string, unknown>
type Segment = { fromMonth: number; toMonth: number | null; unitPrice: number; totalPrice: number | null; name: string | null }
type Charge = { chargeCode: string; chargeType: string; unitPrice: number; totalPrice: number | null; standardTotalPrice?: number | null; schedule?: Segment[] }
type Line = { lineId: string; mrcTotal: number; nrcTotal: number; charges: Charge[] }
type Quote = { id: string; cpqStatus: string; pricingRevision?: number; lines: Line[] }

async function call(request: APIRequestContext, token: string, method: 'POST' | 'GET' | 'PUT', path: string, data?: Json) {
  const res = await apiRequest(request, method, path, { token, ...(data ? { data } : {}) })
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Json }
}

/** One offering with a 100 MRC and a 50 NRC charge, a customer and a quote with one 36-month line. */
async function seedQuote(request: APIRequestContext, token: string, cleanup: Array<() => Promise<unknown>>) {
  const tag = uniq()
  const spec = await call(request, token, 'POST', '/api/cpq/product-specifications', { code: `TC015-${tag}`, name: 'TC-015 spec', specType: 'simple', lifecycleStatus: 'active' })
  expect(spec.status).toBe(201)
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-specifications', { token, data: { id: spec.body.id } }))
  const offering = await call(request, token, 'POST', '/api/cpq/product-offerings', { specId: spec.body.id, code: `TC015-OFF-${tag}`, name: `TC-015 Internet ${tag}`, lifecycleStatus: 'active' })
  expect(offering.status).toBe(201)
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-offerings', { token, data: { id: offering.body.id } }))
  for (const [code, chargeType, price] of [['fee', 'mrc', 100], ['setup', 'nrc', 50]] as const) {
    const charge = await call(request, token, 'POST', '/api/cpq/product-charges', {
      offeringId: offering.body.id, code: `${code}-${tag}`, name: code === 'fee' ? 'Monthly fee' : 'Setup fee', chargeType,
      chargeModel: 'flat', pricingMethod: 'fixed', fixedPrice: String(price), currencyCode: 'USD',
    })
    expect(charge.status, JSON.stringify(charge.body)).toBe(201)
  }
  const customer = await seedCustomer(request, token, `TC-015 ${tag}`)
  cleanup.push(() => deleteCustomer(request, token, customer))
  const created = await call(request, token, 'POST', '/api/cpq/quotes', { customerId: customer, currencyCode: 'USD' })
  const quoteId = created.body.id as string
  const added = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/items`, { offeringId: offering.body.id, quantity: 1, termMonths: 36 })
  expect(added.status, JSON.stringify(added.body)).toBe(201)
  const quote = added.body as unknown as Quote
  const line = quote.lines[0]
  const code = (type: string) => line.charges.find((charge) => charge.chargeType === type)!.chargeCode
  return { quoteId, lineId: line.lineId, feeCode: code('mrc'), setupCode: code('nrc'), revision: () => latestRevision(request, token, quoteId) }
}

async function latestRevision(request: APIRequestContext, token: string, quoteId: string): Promise<number> {
  const quote = await call(request, token, 'GET', `/api/cpq/quotes/${quoteId}`)
  return (quote.body as unknown as Quote).pricingRevision ?? 0
}

const recurringPhases = (lineId: string) => ({
  target: { level: 'line', quoteLineId: lineId, chargeTypeFilter: 'mrc' }, currencyCode: 'USD', reasonCode: 'promotion', then: null,
  phases: [{ months: 1, adjustmentType: 'price_override', value: 0, name: 'Free trial' }, { months: 3, adjustmentType: 'discount_percent', value: 50, name: '50% off' }],
})

test.describe('TC-CPQ-015: Price dialog, target API and the order panel', () => {
  const cleanup: Array<() => Promise<unknown>> = []
  test.afterEach(async () => {
    for (const run of cleanup.splice(0).reverse()) await run().catch(() => undefined)
  })

  test('recurring phases and a one-time % off on one line; the panel groups by target with author names', async ({ request, page }) => {
    const token = await getAuthToken(request, 'admin')
    const seeded = await seedQuote(request, token, cleanup)
    const phases = await call(request, token, 'PUT', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target`, { ...recurringPhases(seeded.lineId), expectedRevision: await seeded.revision() })
    expect(phases.status, JSON.stringify(phases.body)).toBe(200)
    expect((phases.body.adjustments as unknown[]).length).toBe(2)
    const setup = await call(request, token, 'PUT', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target`, {
      target: { level: 'line', quoteLineId: seeded.lineId, chargeTypeFilter: 'nrc' }, phases: [], then: { adjustmentType: 'discount_percent', value: 20 }, reasonCode: 'promotion',
    })
    expect(setup.status, JSON.stringify(setup.body)).toBe(200)
    const line = (setup.body.quote as Quote).lines[0]
    const fee = line.charges.find((charge) => charge.chargeCode === seeded.feeCode)!
    expect(fee.schedule?.slice(0, 3).map((segment) => [segment.fromMonth, segment.toMonth, segment.totalPrice, segment.name])).toEqual([[1, 1, 0, 'Free trial'], [2, 4, 50, '50% off'], [5, null, 100, null]])
    expect(line.charges.find((charge) => charge.chargeCode === seeded.setupCode)!.totalPrice).toBeCloseTo(40, 2)

    const list = await call(request, token, 'GET', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments`)
    const items = list.body.items as Array<{ createdByName: string | null; createdByEmail: string | null }>
    expect(items).toHaveLength(3)
    expect(items.every((item) => !!(item.createdByName || item.createdByEmail))).toBe(true)

    await login(page, 'admin')
    await page.goto(`/backend/cpq/quotes/${seeded.quoteId}`, { waitUntil: 'domcontentloaded' })
    await hideFloatingOverlays(page)
    const panel = page.getByTestId('cpq-price-adjustments-panel')
    await expect(panel.getByTestId('cpq-price-adjustment-row')).toHaveCount(2, { timeout: 15_000 })
    await expect(panel).toContainText('2 phases: Free trial (month 1) → 50% off (months 2–4), then regular')
    await expect(panel.getByTestId('cpq-price-adjustment-author').first()).not.toHaveText(/^[0-9a-f]{8}$/)

    // The line's % opens the first target that has an adjustment, with the current prices on top.
    await page.getByRole('main').getByTestId('cpq-adjust-price-line').first().click()
    const dialog = page.getByTestId('cpq-price-dialog')
    await expect(dialog.getByTestId('cpq-current-prices')).toContainText('Monthly fee')
    await expect(dialog.getByTestId('cpq-current-priced-by').first()).toContainText('Line · recurring: 2 phases')
    await expect(dialog.getByTestId('cpq-price-target')).toContainText('Whole line · recurring — 2 phases')
    await expect(dialog.getByTestId('cpq-price-step')).toHaveCount(2)
    await expect(dialog.getByTestId('cpq-price-step-name').first()).toHaveValue('Free trial')
  })

  test('a ramp 100 → 110 → 120 with Then above standard', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seeded = await seedQuote(request, token, cleanup)
    const ramp = await call(request, token, 'PUT', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target`, {
      target: { level: 'line', quoteLineId: seeded.lineId, chargeTypeFilter: 'mrc' }, currencyCode: 'USD', reasonCode: 'strategic_deal',
      phases: [{ months: 12, adjustmentType: 'regular' }, { months: 12, adjustmentType: 'price_override', value: 110, name: 'Year 2' }],
      then: { adjustmentType: 'price_override', value: 120 },
    })
    expect(ramp.status, JSON.stringify(ramp.body)).toBe(200)
    const fee = (ramp.body.quote as Quote).lines[0].charges.find((charge) => charge.chargeCode === seeded.feeCode)!
    expect(fee.schedule?.map((segment) => [segment.fromMonth, segment.toMonth, segment.totalPrice])).toEqual([[1, 12, 100], [13, 24, 110], [25, null, 120]])
    // Re-saving the same set changes nothing: the rows keep their ids.
    const again = await call(request, token, 'PUT', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target`, {
      target: { level: 'line', quoteLineId: seeded.lineId, chargeTypeFilter: 'mrc' }, currencyCode: 'USD', reasonCode: 'strategic_deal',
      phases: [{ months: 12, adjustmentType: 'regular' }, { months: 12, adjustmentType: 'price_override', value: 110, name: 'Year 2' }],
      then: { adjustmentType: 'price_override', value: 120 },
    })
    const ids = (body: Json) => (body.adjustments as Array<{ id: string }>).map((row) => row.id)
    expect(ids(again.body)).toEqual(ids(ramp.body))
  })

  test('the conflict is reported before saving and blocks Save', async ({ request, page }) => {
    const token = await getAuthToken(request, 'admin')
    const seeded = await seedQuote(request, token, cleanup)
    expect((await call(request, token, 'PUT', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target`, recurringPhases(seeded.lineId))).status).toBe(200)
    const allCharges = { target: { level: 'line', quoteLineId: seeded.lineId, chargeTypeFilter: null }, phases: [], then: { adjustmentType: 'discount_percent', value: 10 }, reasonCode: 'promotion' }
    const preview = await call(request, token, 'POST', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target/preview`, allCharges)
    expect(preview.status).toBe(200)
    expect((preview.body.errors as Array<{ code: string }>).map((error) => error.code)).toContain('ADJUSTMENT_OVERLAP')
    expect((await call(request, token, 'PUT', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target`, allCharges)).status).toBe(422)

    await login(page, 'admin')
    await page.goto(`/backend/cpq/quotes/${seeded.quoteId}`, { waitUntil: 'domcontentloaded' })
    await hideFloatingOverlays(page)
    await page.getByRole('main').getByTestId('cpq-adjust-price-line').first().click()
    const dialog = page.getByTestId('cpq-price-dialog')
    await dialog.getByTestId('cpq-price-target').click()
    await page.getByRole('option', { name: /Whole line · all charges/ }).click()
    await dialog.getByTestId('cpq-price-one-value').fill('10')
    await expect(dialog.getByTestId('cpq-price-conflict')).toContainText('Overlaps Whole line · recurring — 2 phases', { timeout: 10_000 })
    await expect(dialog.getByTestId('cpq-price-save')).toBeDisabled()
  })

  test('the order shows the source quote adjustments, read-only', async ({ request, page }) => {
    const token = await getAuthToken(request, 'admin')
    const seeded = await seedQuote(request, token, cleanup)
    expect((await call(request, token, 'PUT', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target`, recurringPhases(seeded.lineId))).status).toBe(200)
    const quote = (await call(request, token, 'GET', `/api/cpq/quotes/${seeded.quoteId}`)).body as unknown as Quote
    const ladder = ['ready', 'in_approval', 'approved', 'with_customer', 'accepted']
    for (const targetStatus of ladder.slice(ladder.indexOf(quote.cpqStatus) + 1)) {
      const res = await call(request, token, 'POST', `/api/cpq/quotes/${seeded.quoteId}/status`, { targetStatus })
      expect(res.status, `transition to ${targetStatus}: ${JSON.stringify(res.body)}`).toBeLessThan(300)
    }
    const converted = await call(request, token, 'POST', '/api/cpq/orders', { quoteId: seeded.quoteId })
    expect(converted.status, JSON.stringify(converted.body)).toBeLessThan(300)
    const orderId = converted.body.id as string
    const order = await call(request, token, 'GET', `/api/cpq/orders/${orderId}`)
    const adjustments = order.body.priceAdjustments as Array<{ phaseName: string | null; reasonLabel: string | null }>
    expect(adjustments.map((row) => row.phaseName).sort()).toEqual(['50% off', 'Free trial'])
    expect(adjustments.every((row) => row.reasonLabel === 'Promotion')).toBe(true)
    // Frozen once converted.
    expect((await call(request, token, 'PUT', `/api/cpq/quotes/${seeded.quoteId}/price-adjustments/target`, { target: recurringPhases(seeded.lineId).target, phases: [], then: null })).status).toBe(409)

    await login(page, 'admin')
    await page.goto(`/backend/cpq/orders/${orderId}`, { waitUntil: 'domcontentloaded' })
    await hideFloatingOverlays(page)
    const panel = page.getByTestId('cpq-order-price-adjustments-panel')
    await expect(panel).toContainText('2 phases: Free trial (month 1) → 50% off (months 2–4), then regular', { timeout: 15_000 })
    await expect(panel.getByRole('button', { name: 'Delete adjustment' })).toHaveCount(0)
  })
})

import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CPQ-001: cost-plus smoke (API-driven).
 *
 * Needs the GIX demo tenant (`yarn mercato demo_tenants seed`), whose seed turns
 * `cpq.cost_plus` on and provides the "IP Transit with partner tail" offering:
 *   admin@gix.com    — pricing admin: makes a charge cost-plus
 *   employee@gix.com — sales rep: quotes it (sees costs read-only)
 *   pricing@gix.com  — pricing manager: confirms the costs, converts the quote
 * Override the logins with CPQ_DEMO_GIX_*_EMAIL / *_PASSWORD, like the seed.
 */

const credentials = {
  admin: { email: process.env.CPQ_DEMO_GIX_ADMIN_EMAIL || 'admin@gix.com', password: process.env.CPQ_DEMO_GIX_ADMIN_PASSWORD || 'secret' },
  rep: { email: process.env.CPQ_DEMO_GIX_EMPLOYEE_EMAIL || 'employee@gix.com', password: process.env.CPQ_DEMO_GIX_EMPLOYEE_PASSWORD || 'secret' },
  manager: { email: process.env.CPQ_DEMO_GIX_PRICING_MANAGER_EMAIL || 'pricing@gix.com', password: process.env.CPQ_DEMO_GIX_PRICING_MANAGER_PASSWORD || 'secret' },
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(request: APIRequestContext, token: string, method: string, path: string, data?: unknown) {
  const response = await apiRequest(request, method, path, { token, data })
  const raw = await response.text()
  return { status: response.status(), body: (raw ? JSON.parse(raw) : {}) as Json }
}

test.describe('TC-CPQ-001: cost-plus smoke', () => {
  test('admin makes a charge cost-plus, rep quotes it, pricing manager confirms the cost, conversion succeeds', async ({ request }) => {
    const admin = await getAuthToken(request, credentials.admin.email, credentials.admin.password)
    const rep = await getAuthToken(request, credentials.rep.email, credentials.rep.password)
    const manager = await getAuthToken(request, credentials.manager.email, credentials.manager.password)
    const suffix = Date.now().toString(36)

    // 1. Admin: a new cost-plus NRC charge on the seeded IP Transit offering, with one on-request price-basis cost.
    const existing = await call(request, admin, 'GET', '/api/cpq/product-charges?pageSize=100')
    const transit = (existing.body.items as Json[]).find((charge) => charge.code === 'transit_fee')
    expect(transit, 'seeded transit_fee charge (GIX demo tenant)').toBeTruthy()
    const created = await call(request, admin, 'POST', '/api/cpq/product-charges', {
      productId: transit!.productId, offeringId: transit!.offeringId, code: `smoke_setup_${suffix}`, name: 'Smoke setup',
      chargeType: 'nrc', chargeModel: 'flat', pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 20, isActive: false,
    })
    expect(created.status).toBe(201)
    const chargeId = (created.body.id ?? created.body.item?.id) as string
    const element = await call(request, admin, 'POST', '/api/cpq/charge-cost-elements', {
      productChargeId: chargeId, code: `smoke_setup_cost_${suffix}`, name: 'Smoke setup cost', role: 'price_basis', costType: 'nrc',
      source: 'on_request', costModel: 'flat', estimateAmount: 100, currencyCode: 'USD',
    })
    expect(element.status).toBe(201)
    expect((await call(request, admin, 'PUT', '/api/cpq/product-charges', { id: chargeId, isActive: true })).status).toBe(200)

    // 2. Rep: quote the offering. The cost-plus charge is priced from the estimate: 100 x 1.2 = 120.00.
    // Own customer fixture: the test must not depend on seeded CRM data.
    const customerId = await createCompanyFixture(request, admin, `Cost-plus smoke ${suffix}`)
    const quote = await call(request, rep, 'POST', '/api/cpq/quotes', { customerId, currencyCode: 'USD' })
    expect(quote.status).toBe(201)
    const quoteId = quote.body.id as string
    const withLine = await call(request, rep, 'POST', `/api/cpq/quotes/${quoteId}/items`, {
      offeringId: transit!.offeringId, configuration: { data_centre: 'equinix-am1' }, quantity: 1, termMonths: 12,
    })
    expect(withLine.status).toBeLessThan(300)
    const setup = (withLine.body.lines[0].charges as Json[]).find((charge) => charge.chargeCode === `smoke_setup_${suffix}`)
    expect(setup?.totalPrice).toBe(120)

    // The rep sees costs read-only: reading works, writing is forbidden.
    const repCosts = await call(request, rep, 'GET', `/api/cpq/quotes/${quoteId}/costs`)
    expect(repCosts.status).toBe(200)
    const costLines = (repCosts.body.lines as Json[]).flatMap((line) => line.costs as Json[])
    const estimated = costLines.filter((cost) => cost.role === 'price_basis' && cost.valueStatus === 'estimated')
    expect(estimated.length).toBeGreaterThan(0)
    expect((await call(request, rep, 'PATCH', `/api/cpq/quotes/${quoteId}/costs/${estimated[0].id}`, { valueStatus: 'confirmed' })).status).toBe(403)

    // 3. Send and accept; conversion is refused while a price-basis cost is only estimated.
    for (const targetStatus of ['with_customer', 'accepted']) {
      expect((await call(request, rep, 'POST', `/api/cpq/quotes/${quoteId}/status`, { targetStatus })).status).toBe(200)
    }
    const refused = await call(request, manager, 'POST', '/api/cpq/orders', { quoteId })
    expect(refused.status).toBe(422)
    expect(refused.body.error).toBe('COSTS_NOT_CONFIRMED')

    // 4. Pricing manager confirms every estimated price-basis cost at its current value (price-neutral, allowed under the lock).
    for (const cost of estimated) {
      const confirmed = await call(request, manager, 'PATCH', `/api/cpq/quotes/${quoteId}/costs/${cost.id}`, { valueStatus: 'confirmed' })
      expect(confirmed.status).toBe(200)
    }

    // 5. Conversion succeeds.
    const order = await call(request, manager, 'POST', '/api/cpq/orders', { quoteId })
    expect(order.status).toBeLessThan(300)
  })
})

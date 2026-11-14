const resolveProductCharges = jest.fn()
const enabled = jest.fn()
const previewCatalogCosts = jest.fn()
const em = { fork: () => ({}) }
jest.mock('../../../../services/costs/costResolution', () => ({ previewCatalogCosts: (...args: unknown[]) => previewCatalogCosts(...args) }))
jest.mock('../../../context', () => ({ resolveCpqRouteContext: async () => ({ auth: { sub: 'user' }, tenantId: 'tenant', organizationId: 'org', em,
  container: { resolve: (name: string) => (name === 'cpqCostService' ? { enabled } : { resolveProductCharges }) } }) }))
import { POST, openApi } from '../route'
const offeringId = '11111111-1111-4111-8111-111111111111'
const charge = { chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'flat', quantity: 1,
  unitPrice: 90, totalPrice: 90, currencyCode: 'USD', listUnitPrice: 100, listTotalPrice: 100, standardUnitPrice: 90, standardTotalPrice: 90,
  adjustments: [{ origin: 'rule', ruleCode: 'volume', ruleName: 'Volume', ruleType: 'discount_percent', value: 10, unitPriceBefore: 100, unitPriceAfter: 90, delta: -10 }] }
const body = { primaryItem: { offeringId, configuration: {} }, childItems: [{ offeringId, configuration: {} }], currencyCode: 'USD' }
function request(input: unknown) { return new Request('http://localhost/api/cpq/quotes/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) }
beforeEach(() => {
  resolveProductCharges.mockReset(); resolveProductCharges.mockResolvedValue([charge])
  enabled.mockReset(); enabled.mockResolvedValue(true)
  previewCatalogCosts.mockReset(); previewCatalogCosts.mockResolvedValue([])
})
it('keeps waterfall fields out of primary and child prices by default while tagging rules', async () => {
  const response = await POST(request(body))
  expect(response.status).toBe(200)
  const result = await response.json()
  for (const item of [result.primaryCharges[0], result.childItems[0].charges[0]]) {
    expect(item).not.toHaveProperty('listUnitPrice')
    expect(item).not.toHaveProperty('listTotalPrice')
    expect(item).not.toHaveProperty('standardUnitPrice')
    expect(item).not.toHaveProperty('standardTotalPrice')
    expect(item.adjustments[0].origin).toBe('rule')
  }
  expect(result.totals.mrcTotal).toBe(180)
})
it('returns list and standard fields only with explicit includeWaterfall', async () => {
  const result = await (await POST(request({ ...body, includeWaterfall: true }))).json()
  expect(result.primaryCharges[0]).toEqual(charge)
  expect(result.childItems[0].charges[0]).toEqual(charge)
})
it('never forwards draft adjustments to the catalog engine', async () => {
  await POST(request({ ...body, priceAdjustments: [{ value: 80 }] }))
  expect(resolveProductCharges).toHaveBeenCalledWith(expect.objectContaining({ offeringId, productId: undefined, configuration: {}, currencyCode: 'USD', tenantId: 'tenant', organizationId: 'org' }))
  expect(resolveProductCharges.mock.calls[0][0]).not.toHaveProperty('priceAdjustments')
})
it('rejects malformed waterfall flags and documents the request contract', async () => {
  expect((await POST(request({ ...body, includeWaterfall: 'yes' }))).status).toBe(400)
  expect(resolveProductCharges).not.toHaveBeenCalled()
  expect(openApi.methods.POST?.requestBody).toBeDefined()
})

const costPlusCharge = (over: Record<string, unknown> = {}) => ({ chargeCode: 'cp', chargeName: 'Cost plus', chargeType: 'mrc', pricingMethod: 'cost_plus', quantity: 1,
  unitPrice: 120, totalPrice: 120, currencyCode: 'USD', ...over })
const unpriced = costPlusCharge({ unitPrice: null, totalPrice: null, fallbackPrice: 99 })
const basis = (valueStatus: string, extra: Record<string, unknown> = {}) => ({ chargeCode: 'cp', role: 'price_basis', valueStatus, instanceAmount: '100', costKey: 'k', name: 'Secret supplier cost', ...extra })
const keys = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((entry) => keys(entry, out))
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) { out.push(key); keys(entry, out) }
  return out
}
describe('cost-plus charges', () => {
  it('prices a cost-plus charge from in-memory catalog costs without flags', async () => {
    resolveProductCharges.mockResolvedValue([costPlusCharge()]); previewCatalogCosts.mockResolvedValue([basis('confirmed')])
    const result = await (await POST(request({ primaryItem: body.primaryItem, childItems: [], currencyCode: 'USD' }))).json()
    expect(result.primaryCharges[0]).toMatchObject({ pricingMethod: 'cost_plus', unitPrice: 120, totalPrice: 120 })
    expect(result.primaryCharges[0]).not.toHaveProperty('indicative')
    expect(result.primaryCharges[0]).not.toHaveProperty('priceOnRequest')
    expect(result.totals.mrcTotal).toBe(120)
    const context = resolveProductCharges.mock.calls[0][0].costPlus
    expect(context.enabled).toBe(true)
  })
  it('marks the charge indicative when a price-basis cost is estimated', async () => {
    resolveProductCharges.mockResolvedValue([costPlusCharge()]); previewCatalogCosts.mockResolvedValue([basis('estimated')])
    const result = await (await POST(request({ primaryItem: body.primaryItem, childItems: [], currencyCode: 'USD' }))).json()
    expect(result.primaryCharges[0].indicative).toBe(true)
    expect(result.totals.mrcTotal).toBe(120)
  })
  it('flags priceOnRequest for a pending cost and excludes it from totals, dropping the fallback price', async () => {
    resolveProductCharges.mockResolvedValue([unpriced, { ...charge, adjustments: [] }]); previewCatalogCosts.mockResolvedValue([basis('none', { instanceAmount: null })])
    const result = await (await POST(request({ primaryItem: body.primaryItem, childItems: [], currencyCode: 'USD' }))).json()
    expect(result.primaryCharges[0]).toMatchObject({ priceOnRequest: true, unitPrice: null, totalPrice: null })
    expect(result.primaryCharges[0]).not.toHaveProperty('fallbackPrice')
    expect(result.primaryCharges[1]).not.toHaveProperty('priceOnRequest')
    expect(result.totals.mrcTotal).toBe(90)
  })
  it('flags priceOnRequest when the toggle is off and resolves no costs', async () => {
    enabled.mockResolvedValue(false)
    resolveProductCharges.mockResolvedValue([unpriced])
    const result = await (await POST(request({ primaryItem: body.primaryItem, childItems: [], currencyCode: 'USD' }))).json()
    expect(result.primaryCharges[0].priceOnRequest).toBe(true)
    expect(result.totals.mrcTotal).toBe(0)
    expect(previewCatalogCosts).not.toHaveBeenCalled()
    expect(resolveProductCharges.mock.calls[0][0].costPlus.enabled).toBe(false)
  })
  it('never leaks cost, supplier or markup keys or values anywhere in the response', async () => {
    resolveProductCharges.mockResolvedValue([costPlusCharge(), unpriced])
    previewCatalogCosts.mockResolvedValue([basis('estimated', { supplierName: 'Acme', unitAmount: '100' })])
    const text = await (await POST(request({ ...body, includeWaterfall: true }))).text()
    for (const key of keys(JSON.parse(text))) expect(key).not.toMatch(/cost|supplier|markup|instanceAmount|unitAmount/i)
    expect(text).not.toMatch(/Secret supplier|Acme/)
  })
  it('keeps priced usage charges and drops price-on-request usage from the totals', async () => {
    resolveProductCharges.mockResolvedValue([costPlusCharge({ chargeType: 'usage', unitPrice: null, totalPrice: null }), { ...charge, chargeCode: 'u', chargeType: 'usage', totalPrice: null }])
    const result = await (await POST(request({ primaryItem: body.primaryItem, childItems: [], currencyCode: 'USD' }))).json()
    expect(result.totals.usageCharges.map((u: { chargeCode: string }) => u.chargeCode)).toEqual(['u'])
  })
})

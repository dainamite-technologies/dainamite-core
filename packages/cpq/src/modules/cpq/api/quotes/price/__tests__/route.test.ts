const resolveProductCharges = jest.fn()
jest.mock('../../../context', () => ({ resolveCpqRouteContext: async () => ({ auth: { sub: 'user' }, tenantId: 'tenant', organizationId: 'org', container: { resolve: () => ({ resolveProductCharges }) } }) }))
import { POST, openApi } from '../route'
const offeringId = '11111111-1111-4111-8111-111111111111'
const charge = { chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'flat', quantity: 1,
  unitPrice: 90, totalPrice: 90, currencyCode: 'USD', listUnitPrice: 100, listTotalPrice: 100, standardUnitPrice: 90, standardTotalPrice: 90,
  adjustments: [{ origin: 'rule', ruleCode: 'volume', ruleName: 'Volume', ruleType: 'discount_percent', value: 10, unitPriceBefore: 100, unitPriceAfter: 90, delta: -10 }] }
const body = { primaryItem: { offeringId, configuration: {} }, childItems: [{ offeringId, configuration: {} }], currencyCode: 'USD' }
function request(input: unknown) { return new Request('http://localhost/api/cpq/quotes/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) }
beforeEach(() => { resolveProductCharges.mockReset(); resolveProductCharges.mockResolvedValue([charge]) })
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
  expect(resolveProductCharges).toHaveBeenCalledWith({ offeringId, productId: undefined, configuration: {}, currencyCode: 'USD', tenantId: 'tenant', organizationId: 'org' })
})
it('rejects malformed waterfall flags and documents the request contract', async () => {
  expect((await POST(request({ ...body, includeWaterfall: 'yes' }))).status).toBe(400)
  expect(resolveProductCharges).not.toHaveBeenCalled()
  expect(openApi.methods.POST?.requestBody).toBeDefined()
})

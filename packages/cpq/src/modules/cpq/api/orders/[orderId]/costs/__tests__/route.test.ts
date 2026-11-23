import { CpqOrderConfiguration, CpqOrderLineConfiguration, CpqOrderLineCost } from '../../../../../data/entities'

type Row = Record<string, any>
const enabled = jest.fn(), viewCosts = jest.fn()
const em: Row = { findOne: jest.fn(), find: jest.fn() }
const ctx = { auth: { sub: 'user' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em,
  container: { resolve: (name: string) => ({ cpqCostService: { enabled } } as Record<string, unknown>)[name] } }
jest.mock('../../../../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../../../../_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => viewCosts(...args) }))
import { GET, metadata, openApi } from '../route'

const orderId = '11111111-1111-4111-8111-111111111111', lineId = '22222222-2222-4222-8222-222222222222', costId = '33333333-3333-4333-8333-333333333333'
const params = { params: Promise.resolve({ orderId }) }
const request = () => new Request('http://localhost/api/cpq/orders/x/costs')
const costRow: Row = {
  id: costId, orderConfigurationId: orderId, orderLineId: lineId, sourceQuoteLineCostId: '44444444-4444-4444-8444-444444444444', inventoryCostId: null,
  costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'fixed', costModel: 'flat',
  valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: '40.0000', instanceAmount: '40.0000', totalAmount: '80.0000', currencyCode: 'EUR',
  fxRate: null, fxRateDate: null, supplierId: null, supplierName: 'Acme', supplierQuoteRef: 'REF', validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  viewCosts.mockResolvedValue(true)
  em.findOne.mockImplementation(async (entity: unknown, where: Row) => (entity === CpqOrderConfiguration && where.id === orderId ? { id: orderId, orderId: 'sales', currencyCode: 'EUR' } : null))
  em.find.mockImplementation(async (entity: unknown) => (entity === CpqOrderLineConfiguration
    ? [{ orderLineId: lineId, quantity: 2, termMonths: 12, action: 'add', parentLineId: null, charges: [{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 100 }] }]
    : entity === CpqOrderLineCost ? [costRow] : []))
})

it('requires cpq.orders.view and never requireRoles; documents the route', () => {
  expect(metadata.GET.requireFeatures).toEqual(['cpq.orders.view'])
  expect(JSON.stringify(metadata)).not.toContain('requireRoles')
  expect(openApi.methods.GET).toBeDefined()
})

it('without cpq.costs.view: status-only projection, no amounts, supplier or margin', async () => {
  viewCosts.mockResolvedValue(false)
  const response = await GET(request(), params)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toEqual({ orderId, lines: [{ orderLineId: lineId, costs: [{ id: costId, costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed' }] }] })
  const json = JSON.stringify(body)
  for (const leak of ['80.0000', '40.0000', 'Acme', 'REF', 'unitAmount', 'totalAmount', 'supplier', 'margin', 'fxRate']) expect(json).not.toContain(leak)
  // the margin is not even loaded for a non-holder
  expect(em.find).toHaveBeenCalledTimes(2)
})

it('with cpq.costs.view: full projection and the order margin (cost total x quantity basis)', async () => {
  const body = await (await GET(request(), params)).json()
  expect(body.currencyCode).toBe('EUR')
  expect(body.lines[0].costs[0]).toMatchObject({ totalAmount: '80.0000', unitAmount: '40.0000', supplierName: 'Acme', inventoryCostId: null, sourceQuoteLineCostId: '44444444-4444-4444-8444-444444444444', origin: 'catalog' })
  expect(body.margin).toMatchObject({ mrcOffer: 200, mrcCost: 80, mrcMargin: 120 })
})

it('every query is tenant scoped and excludes soft-deleted rows', async () => {
  await GET(request(), params)
  for (const [, where] of [...em.findOne.mock.calls, ...em.find.mock.calls]) expect(where).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null })
})

it('toggle off: 404 without reading; unknown order: 404', async () => {
  enabled.mockResolvedValue(false)
  expect((await GET(request(), params)).status).toBe(404)
  expect(em.findOne).not.toHaveBeenCalled()
  enabled.mockResolvedValue(true)
  em.findOne.mockResolvedValue(null)
  expect((await GET(request(), params)).status).toBe(404)
})

it('a malformed order id is a 400', async () => {
  expect((await GET(request(), { params: Promise.resolve({ orderId: 'nope' }) })).status).toBe(400)
})

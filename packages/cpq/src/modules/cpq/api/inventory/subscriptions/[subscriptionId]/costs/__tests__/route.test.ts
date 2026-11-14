import { CpqInventoryAsset, CpqInventoryCost, CpqInventorySubscription, CpqInventorySubscriptionItem } from '../../../../../../data/entities'

type Row = Record<string, any>
const enabled = jest.fn(), viewCosts = jest.fn()
const em: Row = { findOne: jest.fn(), find: jest.fn() }
const ctx = { auth: { sub: 'user' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em,
  container: { resolve: (name: string) => ({ cpqCostService: { enabled } } as Record<string, unknown>)[name] } }
jest.mock('../../../../../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../../../../../_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => viewCosts(...args) }))
import { GET, metadata, openApi } from '../route'

const subId = '11111111-1111-4111-8111-111111111111', itemId = '22222222-2222-4222-8222-222222222222', deadItemId = '55555555-5555-4555-8555-555555555555'
const assetId = '33333333-3333-4333-8333-333333333333'
const params = { params: Promise.resolve({ subscriptionId: subId }) }
const request = (query = '') => new Request(`http://localhost/api/cpq/inventory/subscriptions/x/costs${query}`)
const cost = (over: Row = {}): Row => ({
  id: 'c1', subscriptionId: subId, subscriptionItemId: itemId, assetId: null, status: 'active', startedAt: '2026-11-01', endedAt: null, lastChangeId: null,
  costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'fixed', costModel: 'flat',
  valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: '40.0000', instanceAmount: '40.0000', totalAmount: '80.0000', currencyCode: 'EUR',
  supplierName: 'Acme', supplierQuoteRef: null, validUntil: null, ...over,
})
let costs: Row[]
const item = (over: Row = {}): Row => ({ id: itemId, subscriptionId: subId, status: 'active', mrcAmount: '200', nrcAmount: '0', quantity: 2, charges: [{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 100 }], ...over })
const asset: Row = { id: assetId, subscriptionId: subId, status: 'active', purchasePrice: '500', currencyCode: 'EUR' }

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  viewCosts.mockResolvedValue(true)
  costs = [cost(), cost({ id: 'c2', costKey: 'old', status: 'ended', endedAt: '2026-11-05' }), cost({ id: 'c3', costKey: 'box', subscriptionItemId: null, assetId, costType: 'nrc', chargeCode: null, totalAmount: '300.0000' })]
  em.findOne.mockImplementation(async (entity: unknown, where: Row) => (entity === CpqInventorySubscription && where.id === subId ? { id: subId, currencyCode: 'EUR' } : null))
  em.find.mockImplementation(async (entity: unknown) => (entity === CpqInventorySubscriptionItem ? [item(), item({ id: deadItemId, status: 'terminated' })]
    : entity === CpqInventoryAsset ? [asset] : entity === CpqInventoryCost ? costs : []))
})

it('requires cpq.inventory.view, never requireRoles, and documents the route', () => {
  expect(metadata.GET.requireFeatures).toEqual(['cpq.inventory.view'])
  expect(JSON.stringify(metadata)).not.toContain('requireRoles')
  expect(openApi.methods.GET).toBeDefined()
})

it('without cpq.costs.view: status-only projection (open costs, cost-owning assets), no value, supplier or margin', async () => {
  viewCosts.mockResolvedValue(false)
  const body = await (await GET(request(), params)).json()
  expect(body).toEqual({
    subscriptionId: subId,
    items: [{ subscriptionItemId: itemId, itemStatus: 'active', costs: [{ id: 'c1', costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed', status: 'active' }] }],
    assets: [{ assetId, assetStatus: 'active', costs: [{ id: 'c3', costKey: 'box', name: 'Tail', role: 'price_basis', costType: 'nrc', valueStatus: 'confirmed', status: 'active' }] }],
  })
  const json = JSON.stringify(body)
  for (const leak of ['80.0000', '300.0000', 'Acme', 'unitAmount', 'totalAmount', 'supplier', 'margin', 'fxRate', 'startedAt']) expect(json).not.toContain(leak)
})

it('with cpq.costs.view: values, per-item and per-asset margins and the subscription roll-up', async () => {
  const body = await (await GET(request(), params)).json()
  expect(body.currencyCode).toBe('EUR')
  expect(body.items[0].costs[0]).toMatchObject({ totalAmount: '80.0000', supplierName: 'Acme', startedAt: '2026-11-01', endedAt: null, lastChangeId: null })
  expect(body.items[0].margin).toMatchObject({ mrcOffer: 200, mrcCost: 80, mrcMargin: 120, coverage: 100 })
  expect(body.assets[0].margin).toEqual({ nrcOffer: 500, nrcCost: 300, nrcMargin: 200, mrcCost: 0 })
  // roll-up = live items + cost-owning assets; the terminated item is not counted
  expect(body.margin).toMatchObject({ mrcOffer: 200, mrcCost: 80, nrcOffer: 500, nrcCost: 300 })
})

it('includeEnded=true lists ended costs too, but the margin still counts open costs only', async () => {
  const body = await (await GET(request('?includeEnded=true'), params)).json()
  expect(body.items[0].costs.map((c: Row) => c.id)).toEqual(['c2', 'c1']) // ordered by costKey: old, tail
  expect(body.items[0].margin.mrcCost).toBe(80)
})

it('a terminated item owner is not live: its costs are listed only with includeEnded and carry no margin', async () => {
  costs.push(cost({ id: 'c9', subscriptionItemId: deadItemId, costKey: 'dead' }))
  const open = await (await GET(request(), params)).json()
  expect(open.items.map((i: Row) => i.subscriptionItemId)).toEqual([itemId])
  const all = await (await GET(request('?includeEnded=true'), params)).json()
  const dead = all.items.find((i: Row) => i.subscriptionItemId === deadItemId)
  expect(dead).toMatchObject({ itemStatus: 'terminated', margin: null })
})

it('reads with four queries and tenant / soft-delete scoping', async () => {
  await GET(request(), params)
  expect(em.findOne).toHaveBeenCalledTimes(1)
  expect(em.find).toHaveBeenCalledTimes(3)
  for (const [, where] of [...em.findOne.mock.calls, ...em.find.mock.calls]) expect(where).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null })
})

it('toggle off: 404 without reading; unknown subscription: 404; bad includeEnded: 400', async () => {
  enabled.mockResolvedValue(false)
  expect((await GET(request(), params)).status).toBe(404)
  expect(em.findOne).not.toHaveBeenCalled()
  enabled.mockResolvedValue(true)
  em.findOne.mockResolvedValue(null)
  expect((await GET(request(), params)).status).toBe(404)
  expect((await GET(request('?includeEnded=maybe'), params)).status).toBe(400)
})

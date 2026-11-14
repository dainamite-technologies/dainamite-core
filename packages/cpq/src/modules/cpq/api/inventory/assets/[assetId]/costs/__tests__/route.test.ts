import { CpqInventoryAsset, CpqInventoryCost, CpqInventorySubscriptionItem } from '../../../../../../data/entities'

type Row = Record<string, any>
const enabled = jest.fn(), viewCosts = jest.fn()
const em: Row = { findOne: jest.fn(), find: jest.fn() }
const ctx = { auth: { sub: 'user' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em,
  container: { resolve: (name: string) => ({ cpqCostService: { enabled } } as Record<string, unknown>)[name] } }
jest.mock('../../../../../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../../../../../_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => viewCosts(...args) }))
import { GET, metadata, openApi } from '../route'

const assetId = '33333333-3333-4333-8333-333333333333', subId = '11111111-1111-4111-8111-111111111111', itemId = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ assetId }) }
const request = (query = '') => new Request(`http://localhost/api/cpq/inventory/assets/x/costs${query}`)
const cost = (over: Row = {}): Row => ({
  id: 'c1', subscriptionId: subId, subscriptionItemId: null, assetId, status: 'active', startedAt: '2026-11-01', endedAt: null, lastChangeId: 'log-1',
  costKey: 'box', chargeCode: null, origin: 'manual', name: 'Box', role: 'price_basis', costType: 'nrc', source: 'fixed', costModel: 'flat',
  valueStatus: 'confirmed', valueOrigin: 'manual', unitAmount: '300.0000', instanceAmount: '300.0000', totalAmount: '300.0000', currencyCode: 'EUR',
  supplierName: 'Acme', supplierQuoteRef: null, validUntil: null, ...over,
})
let assetRow: Row, assetCosts: Row[], itemCosts: Row[], siblings: Row[]

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  viewCosts.mockResolvedValue(true)
  assetRow = { id: assetId, subscriptionId: subId, sourceQuoteLineId: null, status: 'active', purchasePrice: '500', currencyCode: 'EUR' }
  assetCosts = [cost()]
  itemCosts = []
  siblings = []
  em.findOne.mockImplementation(async (entity: unknown, where: Row) => (entity === CpqInventoryAsset && where.id === assetId ? assetRow : null))
  em.find.mockImplementation(async (entity: unknown, where: Row) => (entity === CpqInventoryCost ? (where.assetId ? assetCosts : itemCosts)
    : entity === CpqInventorySubscriptionItem ? siblings : []))
})

it('requires cpq.inventory.view, never requireRoles, and documents the route', () => {
  expect(metadata.GET.requireFeatures).toEqual(['cpq.inventory.view'])
  expect(JSON.stringify(metadata)).not.toContain('requireRoles')
  expect(openApi.methods.GET).toBeDefined()
})

it('without cpq.costs.view: status-only projection (asset-owned costs), no value, supplier or margin', async () => {
  viewCosts.mockResolvedValue(false)
  const body = await (await GET(request(), params)).json()
  expect(body).toEqual({ assetId, assetStatus: 'active', ownerItemId: null, costs: [{ id: 'c1', costKey: 'box', name: 'Box', role: 'price_basis', costType: 'nrc', valueStatus: 'confirmed', status: 'active' }] })
  const json = JSON.stringify(body)
  for (const leak of ['300.0000', 'Acme', 'unitAmount', 'totalAmount', 'supplier', 'margin', 'lastChangeId']) expect(json).not.toContain(leak)
})

it('with cpq.costs.view: values and the asset margin (purchase price - NRC costs)', async () => {
  const body = await (await GET(request(), params)).json()
  expect(body.currencyCode).toBe('EUR')
  expect(body.costs[0]).toMatchObject({ totalAmount: '300.0000', supplierName: 'Acme', startedAt: '2026-11-01', lastChangeId: 'log-1' })
  expect(body.margin).toEqual({ nrcOffer: 500, nrcCost: 300, nrcMargin: 200, mrcCost: 0 })
})

it('an asset created with its own item (ARC add) owns no costs: ownerItemId points at the item that does', async () => {
  assetRow.sourceQuoteLineId = '66666666-6666-4666-8666-666666666666'
  assetCosts = []
  siblings = [{ id: itemId }]
  itemCosts = [cost({ id: 'ic', assetId: null, subscriptionItemId: itemId })]
  const body = await (await GET(request(), params)).json()
  expect(body.ownerItemId).toBe(itemId)
  expect(body.costs).toEqual([])
  expect(body.margin).toBeNull()
})

it('a cancelled asset lists no open costs; includeEnded=true lists them with no margin', async () => {
  assetRow.status = 'cancelled'
  expect((await (await GET(request(), params)).json()).costs).toEqual([])
  const all = await (await GET(request('?includeEnded=true'), params)).json()
  expect(all.costs).toHaveLength(1)
  expect(all.margin).toBeNull()
})

it('every query is tenant scoped and excludes soft-deleted rows', async () => {
  await GET(request(), params)
  for (const [, where] of [...em.findOne.mock.calls, ...em.find.mock.calls]) expect(where).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null })
})

it('toggle off: 404 without reading; unknown asset: 404', async () => {
  enabled.mockResolvedValue(false)
  expect((await GET(request(), params)).status).toBe(404)
  expect(em.findOne).not.toHaveBeenCalled()
  enabled.mockResolvedValue(true)
  em.findOne.mockResolvedValue(null)
  expect((await GET(request(), params)).status).toBe(404)
})
